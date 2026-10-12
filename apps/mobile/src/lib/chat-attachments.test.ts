import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { UPLOAD_PURPOSE_LIMITS } from '@photoo/shared';

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
const mockProbeSize = { current: { width: 1000, height: 800 } };
const mockSaveAsync = jest.fn<() => Promise<{ uri: string; width: number; height: number }>>();
const mockResize = jest.fn();
jest.mock('expo-image-manipulator', () => ({
  SaveFormat: { JPEG: 'jpeg' },
  ImageManipulator: {
    manipulate: (uri: string) => {
      mockManipulate(uri);
      return {
        renderAsync: () => Promise.resolve({ saveAsync: mockSaveAsync, ...mockProbeSize.current }),
        resize: (size: unknown) => {
          mockResize(size);
          return {
            renderAsync: () =>
              Promise.resolve({ saveAsync: mockSaveAsync, ...mockProbeSize.current }),
          };
        },
      };
    },
  },
}));

import {
  AttachmentRejectedError,
  ChatUploadError,
  MAX_ATTACHMENT_BYTES,
  MAX_IMAGE_EDGE_PX,
  isScanningError,
  prepareFile,
  prepareOriginalFile,
  uploadChatAttachment,
  uploadFile,
} from './chat-attachments';

const xhr = installFakeXhr();

beforeEach(() => {
  jest.clearAllMocks();
  xhr.reset();
  mockProbeSize.current = { width: 1000, height: 800 };
  mockSaveAsync.mockResolvedValue({ uri: 'file:///resized.jpg', width: 2048, height: 1536 });
});

describe('prepareFile', () => {
  it('resizes a photo larger than the edge limit before upload', async () => {
    installFakeFetch({ 'file:///big.jpg': 8_000_000, 'file:///resized.jpg': 900_000 });

    const prepared = await prepareFile({
      uri: 'file:///big.jpg',
      name: 'big.jpg',
      mimeType: 'image/jpeg',
      width: 4032,
      height: 3024,
    });

    expect(mockManipulate).toHaveBeenCalledWith('file:///big.jpg');
    expect(mockResize).toHaveBeenCalledWith({ width: MAX_IMAGE_EDGE_PX });
    expect(prepared).toMatchObject({
      uri: 'file:///resized.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 900_000,
    });
  });

  it('resizes along the long edge of a portrait photo', async () => {
    installFakeFetch({});

    await prepareFile({
      uri: 'file:///tall.jpg',
      name: 'tall.jpg',
      mimeType: 'image/jpeg',
      width: 3000,
      height: 4000,
    });

    expect(mockResize).toHaveBeenCalledWith({ height: MAX_IMAGE_EDGE_PX });
  });

  it('re-encodes a small photo without resizing so metadata is stripped', async () => {
    installFakeFetch({ 'file:///small.jpg': 40_000, 'file:///resized.jpg': 30_000 });

    const prepared = await prepareFile({
      uri: 'file:///small.jpg',
      name: 'small.jpg',
      mimeType: 'image/jpeg',
      width: 800,
      height: 600,
    });

    expect(mockSaveAsync).toHaveBeenCalledTimes(1);
    expect(mockResize).not.toHaveBeenCalled();
    expect(prepared).toMatchObject({ uri: 'file:///resized.jpg', sizeBytes: 30_000 });
  });

  it('re-encodes a document-picker image that has no dimensions, reading them first', async () => {
    installFakeFetch({});
    mockProbeSize.current = { width: 1200, height: 900 };

    await prepareFile({ uri: 'file:///doc.jpg', name: 'doc.jpg', mimeType: 'image/jpeg' });

    expect(mockSaveAsync).toHaveBeenCalledTimes(1);
    expect(mockResize).not.toHaveBeenCalled();
  });

  it('resizes a document-picker image whose probed dimensions are over the limit', async () => {
    installFakeFetch({});
    mockProbeSize.current = { width: 3000, height: 4000 };

    await prepareFile({ uri: 'file:///doc.jpg', name: 'doc.jpg', mimeType: 'image/jpeg' });

    expect(mockResize).toHaveBeenCalledWith({ height: MAX_IMAGE_EDGE_PX });
  });

  it('converts an unsupported image format to JPEG', async () => {
    installFakeFetch({});

    const prepared = await prepareFile({
      uri: 'file:///photo.heic',
      name: 'photo.heic',
      mimeType: 'image/heic',
      width: 1000,
      height: 800,
    });

    expect(prepared.mimeType).toBe('image/jpeg');
    expect(prepared.name).toBe('photo.jpg');
    expect(mockResize).not.toHaveBeenCalled();
  });

  it('rejects a file type the API does not accept', async () => {
    installFakeFetch({});

    await expect(
      prepareFile({ uri: 'file:///a.zip', name: 'a.zip', mimeType: 'application/zip' }),
    ).rejects.toMatchObject({ reason: 'unsupportedType' });
  });

  it('rejects a document over the size limit', async () => {
    installFakeFetch({ 'file:///huge.pdf': MAX_ATTACHMENT_BYTES + 1 });

    await expect(
      prepareFile({ uri: 'file:///huge.pdf', name: 'huge.pdf', mimeType: 'application/pdf' }),
    ).rejects.toBeInstanceOf(AttachmentRejectedError);
  });
});

describe('uploadChatAttachment', () => {
  const file = {
    uri: 'file:///a.pdf',
    name: 'a.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 2048,
    blob: { size: 2048 } as Blob,
  };

  function mockCreateAndComplete() {
    mockedPost.mockImplementation((path: string) => {
      if (path === '/v1/uploads') {
        return Promise.resolve({
          data: {
            uploadId: 'up1',
            url: 'https://s3.example.com/put',
            headers: { 'Content-Type': 'application/pdf' },
          },
        });
      }
      return Promise.resolve({ data: { id: 'up1' } });
    });
  }

  it('creates, PUTs with progress, completes and waits for the scan', async () => {
    mockCreateAndComplete();
    mockedGet.mockResolvedValueOnce({ data: { id: 'up1', status: 'clean' } });
    const stages: string[] = [];
    const progress: number[] = [];

    const result = await uploadChatAttachment(file, {
      onProgress: (percent) => progress.push(percent),
      onStageChange: (stage) => stages.push(stage),
    });

    expect(mockedPost.mock.calls.map(([path]) => path)).toEqual([
      '/v1/uploads',
      '/v1/uploads/{id}/complete',
    ]);
    expect(mockedPost).toHaveBeenCalledWith('/v1/uploads', {
      body: { purpose: 'chat_attachment', mimeType: 'application/pdf', sizeBytes: 2048 },
    });
    expect(xhr.puts).toEqual([
      {
        url: 'https://s3.example.com/put',
        headers: { 'Content-Type': 'application/pdf' },
        body: file.blob,
      },
    ]);
    expect(progress).toEqual([50]);
    expect(stages).toEqual(['uploading', 'scanning']);
    expect(result).toEqual({
      uploadId: 'up1',
      name: 'a.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 2048,
    });
  });

  it('fails when the storage PUT is rejected, without completing the upload', async () => {
    mockCreateAndComplete();
    xhr.failNextWith(403);

    await expect(
      uploadChatAttachment(file, { onProgress: jest.fn(), onStageChange: jest.fn() }),
    ).rejects.toMatchObject({ kind: 'upload' });
    expect(mockedPost).toHaveBeenCalledTimes(1);
  });

  it('reports an infected file as its own failure', async () => {
    mockCreateAndComplete();
    mockedGet.mockResolvedValueOnce({ data: { id: 'up1', status: 'infected' } });

    const outcome = uploadChatAttachment(file, { onProgress: jest.fn(), onStageChange: jest.fn() });

    await expect(outcome).rejects.toBeInstanceOf(ChatUploadError);
    await expect(outcome).rejects.toMatchObject({ kind: 'infected' });
  });
});

describe('prepareOriginalFile', () => {
  const picked = {
    uri: 'file:///orig.jpg',
    name: 'orig.jpg',
    mimeType: 'image/jpeg',
    width: 6000,
    height: 4000,
  };

  it('keeps the picked file untouched so provenance metadata survives', async () => {
    installFakeFetch({ 'file:///orig.jpg': 12_000_000 });

    const prepared = await prepareOriginalFile(picked, 'portfolio');

    expect(mockManipulate).not.toHaveBeenCalled();
    expect(mockSaveAsync).not.toHaveBeenCalled();
    expect(prepared).toMatchObject({
      uri: 'file:///orig.jpg',
      name: 'orig.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 12_000_000,
    });
  });

  it('rejects a file over the purpose size limit', async () => {
    installFakeFetch({ 'file:///orig.jpg': UPLOAD_PURPOSE_LIMITS.portfolio.maxSizeBytes + 1 });

    await expect(prepareOriginalFile(picked, 'portfolio')).rejects.toMatchObject({
      reason: 'tooLarge',
    });
  });

  it('rejects a type the purpose does not allow, including a missing type', async () => {
    installFakeFetch({});

    await expect(
      prepareOriginalFile({ ...picked, mimeType: 'application/pdf' }, 'portfolio'),
    ).rejects.toMatchObject({ reason: 'unsupportedType' });
    await expect(
      prepareOriginalFile({ ...picked, mimeType: undefined }, 'portfolio'),
    ).rejects.toMatchObject({ reason: 'unsupportedType' });
  });
});

describe('uploadFile', () => {
  it('declares the given purpose when creating the upload', async () => {
    mockedPost.mockImplementation((path: string) =>
      Promise.resolve(
        path === '/v1/uploads'
          ? { data: { uploadId: 'up1', url: 'https://s3.example.com/put', headers: {} } }
          : { data: { id: 'up1' } },
      ),
    );
    mockedGet.mockResolvedValueOnce({ data: { id: 'up1', status: 'processed' } });

    const result = await uploadFile(
      'portfolio',
      {
        uri: 'file:///a.jpg',
        name: 'a.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 4096,
        blob: { size: 4096 } as Blob,
      },
      { onProgress: jest.fn(), onStageChange: jest.fn() },
    );

    expect(mockedPost).toHaveBeenCalledWith('/v1/uploads', {
      body: { purpose: 'portfolio', mimeType: 'image/jpeg', sizeBytes: 4096 },
    });
    expect(result.uploadId).toBe('up1');
  });
});

describe('isScanningError', () => {
  it('only matches the unscanned-attachment 422', () => {
    expect(
      isScanningError({
        code: 'UNPROCESSABLE_ENTITY',
        message: 'An attachment has not finished scanning yet',
      }),
    ).toBe(true);
    expect(
      isScanningError({
        code: 'UNPROCESSABLE_ENTITY',
        message: 'One or more attachments were not found',
      }),
    ).toBe(false);
    expect(isScanningError({ code: 'TOO_MANY_REQUESTS', message: 'scanning' })).toBe(false);
    expect(isScanningError(undefined)).toBe(false);
  });
});
