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
const mockSaveAsync = jest.fn<() => Promise<{ uri: string; width: number; height: number }>>();
jest.mock('expo-image-manipulator', () => ({
  SaveFormat: { JPEG: 'jpeg' },
  ImageManipulator: {
    manipulate: (uri: string) => {
      mockManipulate(uri);
      return {
        renderAsync: () => Promise.resolve({ saveAsync: mockSaveAsync, width: 800, height: 600 }),
        resize: () => ({
          renderAsync: () => Promise.resolve({ saveAsync: mockSaveAsync, width: 800, height: 600 }),
        }),
      };
    },
  },
}));

import {
  attachVerificationDocument,
  isAcceptedForRequirement,
  uploadVerificationDocument,
} from './verification-upload';

const xhr = installFakeXhr();

const idCard = { key: 'id_card', acceptedMimeTypes: ['image/jpeg', 'application/pdf'] };
const photo = {
  uri: 'file:///id.heic.jpg',
  name: 'id.jpg',
  mimeType: 'image/jpeg',
  width: 800,
  height: 600,
};
const pdf = { uri: 'file:///id.pdf', name: 'id.pdf', mimeType: 'application/pdf' };
const attachedDocument = { id: 'd1', documentKey: 'id_card', virusScanStatus: 'pending' };

function mockUploadFlow(attach: unknown, mimeType = 'image/jpeg') {
  mockedPost.mockImplementation((path: string) => {
    if (path === '/v1/uploads') {
      return Promise.resolve({
        data: {
          uploadId: 'up1',
          url: 'https://s3.example.com/put',
          headers: { 'Content-Type': mimeType },
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

const handlers = () => ({ onProgress: jest.fn(), onStageChange: jest.fn() });

beforeEach(() => {
  jest.clearAllMocks();
  xhr.reset();
  mockSaveAsync.mockResolvedValue({ uri: 'file:///clean.jpg', width: 800, height: 600 });
  installFakeFetch({
    'file:///id.heic.jpg': 4_000_000,
    'file:///clean.jpg': 500_000,
    'file:///id.pdf': 2_000_000,
  });
});

describe('uploadVerificationDocument', () => {
  it('re-encodes a photo so EXIF and GPS are stripped, then attaches it under the document key', async () => {
    mockUploadFlow({ data: attachedDocument, response: new Response(null, { status: 201 }) });
    const stages: string[] = [];

    const result = await uploadVerificationDocument(photo, idCard, {
      onProgress: jest.fn(),
      onStageChange: (stage) => stages.push(stage),
    });

    expect(mockManipulate).toHaveBeenCalledWith('file:///id.heic.jpg');
    expect(mockSaveAsync).toHaveBeenCalledTimes(1);
    expect(mockedPost).toHaveBeenCalledWith('/v1/uploads', {
      body: { purpose: 'verification_document', mimeType: 'image/jpeg', sizeBytes: 500_000 },
    });
    expect(mockedPost).toHaveBeenLastCalledWith('/v1/me/verification-case/documents', {
      body: { uploadId: 'up1', documentKey: 'id_card' },
    });
    expect(stages).toEqual(['uploading', 'scanning', 'attaching']);
    expect(result).toBe(attachedDocument);
  });

  it('sends a PDF unchanged without the image manipulator', async () => {
    mockUploadFlow(
      { data: attachedDocument, response: new Response(null, { status: 201 }) },
      'application/pdf',
    );

    await uploadVerificationDocument(pdf, idCard, handlers());

    expect(mockManipulate).not.toHaveBeenCalled();
    expect(mockedPost).toHaveBeenCalledWith('/v1/uploads', {
      body: { purpose: 'verification_document', mimeType: 'application/pdf', sizeBytes: 2_000_000 },
    });
  });

  it('rejects a PDF over the document size limit before any request', async () => {
    installFakeFetch({
      'file:///id.pdf': UPLOAD_PURPOSE_LIMITS.verification_document.maxSizeBytes + 1,
    });

    await expect(uploadVerificationDocument(pdf, idCard, handlers())).rejects.toMatchObject({
      reason: 'tooLarge',
    });
    expect(mockedPost).not.toHaveBeenCalled();
  });

  it('rejects a file type the requirement does not accept', async () => {
    await expect(
      uploadVerificationDocument(
        pdf,
        { key: 'selfie', acceptedMimeTypes: ['image/jpeg'] },
        handlers(),
      ),
    ).rejects.toMatchObject({ reason: 'unsupportedType' });
    expect(mockedPost).not.toHaveBeenCalled();
  });

  it('reports a 422 while scanning as a pending scan that keeps the upload id', async () => {
    mockUploadFlow({
      data: undefined,
      error: { code: 'UNPROCESSABLE_ENTITY', message: 'The upload has not finished scanning yet' },
      response: new Response(null, { status: 422 }),
    });

    await expect(uploadVerificationDocument(photo, idCard, handlers())).rejects.toMatchObject({
      kind: 'scanPending',
      uploadId: 'up1',
    });
  });

  it('does not attach an infected file', async () => {
    mockUploadFlow({});
    mockedGet.mockResolvedValue({ data: { id: 'up1', status: 'infected' } });

    await expect(uploadVerificationDocument(photo, idCard, handlers())).rejects.toMatchObject({
      kind: 'infected',
    });
    expect(mockedPost).not.toHaveBeenCalledWith(
      '/v1/me/verification-case/documents',
      expect.anything(),
    );
  });
});

describe('attachVerificationDocument', () => {
  it('treats any other failure as an apiError', async () => {
    mockedPost.mockResolvedValue({
      data: undefined,
      error: { code: 'CONFLICT', message: 'no' },
      response: new Response(null, { status: 409 }),
    });

    await expect(attachVerificationDocument('up9', 'id_card')).rejects.toMatchObject({
      kind: 'apiError',
      uploadId: 'up9',
    });
  });
});

describe('isAcceptedForRequirement', () => {
  it('judges an image by its re-encoded JPEG type', () => {
    expect(isAcceptedForRequirement({ ...photo, mimeType: 'image/png' }, ['image/jpeg'])).toBe(
      true,
    );
    expect(isAcceptedForRequirement(photo, ['application/pdf'])).toBe(false);
  });
});
