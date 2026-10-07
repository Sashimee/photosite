import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { installFakeFetch, installFakeXhr } from '../testing/fake-upload';

type ApiCall = (path: string, init?: unknown) => Promise<unknown>;
const mockedGet = jest.fn<ApiCall>();
const mockedPost = jest.fn<ApiCall>();
jest.mock('./api', () => ({
  api: {
    GET: (path: string, init?: unknown) => mockedGet(path, init),
    POST: (path: string, init?: unknown) => mockedPost(path, init),
  },
}));

const mockManipulate = jest.fn();
jest.mock('expo-image-manipulator', () => ({
  SaveFormat: { JPEG: 'jpeg' },
  ImageManipulator: { manipulate: (uri: string) => mockManipulate(uri) },
}));

import { attachPortfolioImage, uploadPortfolioImage } from './portfolio-upload';

const xhr = installFakeXhr();

const picked = {
  uri: 'file:///photo.jpg',
  name: 'photo.jpg',
  mimeType: 'image/jpeg',
  width: 6000,
  height: 4000,
};

const image = { id: 'img1', status: 'processing', url: null, order: 0 };

function mockUploadFlow(attach: unknown) {
  mockedPost.mockImplementation((path: string) => {
    if (path === '/v1/uploads') {
      return Promise.resolve({
        data: {
          uploadId: 'up1',
          url: 'https://s3.example.com/put',
          headers: { 'Content-Type': 'image/jpeg' },
        },
      });
    }
    if (path === '/v1/uploads/{id}/complete') {
      return Promise.resolve({ data: { id: 'up1' } });
    }
    return Promise.resolve(attach);
  });
  mockedGet.mockResolvedValue({ data: { id: 'up1', status: 'clean' } });
}

beforeEach(() => {
  jest.clearAllMocks();
  xhr.reset();
  installFakeFetch({ 'file:///photo.jpg': 9_000_000 });
});

describe('uploadPortfolioImage', () => {
  it('uploads the original without touching the image manipulator, then attaches it', async () => {
    mockUploadFlow({ data: image, response: new Response(null, { status: 201 }) });
    const stages: string[] = [];

    const result = await uploadPortfolioImage(picked, {
      onProgress: jest.fn(),
      onStageChange: (stage) => stages.push(stage),
    });

    expect(mockManipulate).not.toHaveBeenCalled();
    expect(mockedPost).toHaveBeenCalledWith('/v1/uploads', {
      body: { purpose: 'portfolio', mimeType: 'image/jpeg', sizeBytes: 9_000_000 },
    });
    expect(xhr.puts).toHaveLength(1);
    expect(mockedPost).toHaveBeenLastCalledWith('/v1/me/photographer-profile/portfolio', {
      body: { uploadId: 'up1' },
    });
    expect(stages).toEqual(['uploading', 'scanning', 'attaching']);
    expect(result).toBe(image);
  });

  it('reports a 422 while scanning as a pending scan that keeps the upload id', async () => {
    mockUploadFlow({
      data: undefined,
      error: { code: 'UNPROCESSABLE_ENTITY', message: 'The upload has not finished scanning yet' },
      response: new Response(null, { status: 422 }),
    });

    await expect(
      uploadPortfolioImage(picked, { onProgress: jest.fn(), onStageChange: jest.fn() }),
    ).rejects.toMatchObject({ kind: 'scanPending', uploadId: 'up1' });
  });

  it('maps an infected scan to its own failure kind', async () => {
    mockUploadFlow({});
    mockedGet.mockResolvedValue({ data: { id: 'up1', status: 'infected' } });

    await expect(
      uploadPortfolioImage(picked, { onProgress: jest.fn(), onStageChange: jest.fn() }),
    ).rejects.toMatchObject({ kind: 'infected' });
    expect(mockedPost).not.toHaveBeenCalledWith(
      '/v1/me/photographer-profile/portfolio',
      expect.anything(),
    );
  });

  it('rejects an unsupported type before any request', async () => {
    await expect(
      uploadPortfolioImage(
        { ...picked, mimeType: 'image/heic' },
        { onProgress: jest.fn(), onStageChange: jest.fn() },
      ),
    ).rejects.toMatchObject({ reason: 'unsupportedType' });
    expect(mockedPost).not.toHaveBeenCalled();
  });
});

describe('attachPortfolioImage', () => {
  it('treats any other API failure as an apiError', async () => {
    mockedPost.mockResolvedValue({
      data: undefined,
      error: { code: 'FORBIDDEN', message: 'no' },
      response: new Response(null, { status: 403 }),
    });

    await expect(attachPortfolioImage('up9')).rejects.toMatchObject({
      kind: 'apiError',
      uploadId: 'up9',
    });
  });
});
