import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const postMock = vi.fn();
const getMock = vi.fn();
vi.mock('./api', () => ({ api: { POST: postMock, GET: getMock } }));

class FakeXMLHttpRequest {
  static instances: FakeXMLHttpRequest[] = [];
  status = 0;
  upload = {
    onprogress: null as
      ((event: { lengthComputable: boolean; loaded: number; total: number }) => void) | null,
  };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  method = '';
  url = '';

  constructor() {
    FakeXMLHttpRequest.instances.push(this);
  }

  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }

  setRequestHeader() {
    // no-op
  }

  send() {
    // no-op
  }

  respondSuccess(status = 200) {
    this.status = status;
    this.onload?.();
  }

  respondError(status = 500) {
    this.status = status;
    this.onload?.();
  }
}

function fakeFile(name: string, type: string, size: number): File {
  return new File([new Uint8Array(size)], name, { type });
}

function latestXhr(): FakeXMLHttpRequest {
  const xhr = FakeXMLHttpRequest.instances.at(-1);
  if (!xhr) {
    throw new Error('no XMLHttpRequest was created');
  }
  return xhr;
}

const CREATE_RESPONSE = {
  uploadId: 'upload-1',
  url: 'https://storage.example/upload-1',
  headers: { 'Content-Type': 'application/pdf', 'Content-Length': '10' },
  expiresAt: '2026-01-01T00:00:00.000Z',
};

async function importVerificationDocumentUpload() {
  return import('./verification-document-upload');
}

function mockHappyPathUntilScan(scanSequence: { status: string }[]) {
  postMock.mockImplementation((url: string) => {
    if (url === '/v1/uploads') {
      return Promise.resolve({ data: CREATE_RESPONSE });
    }
    if (url === '/v1/uploads/{id}/complete') {
      return Promise.resolve({ data: { id: 'upload-1', status: 'scanning' } });
    }
    throw new Error(`unexpected POST ${url}`);
  });
  let call = 0;
  getMock.mockImplementation(() => {
    const next = scanSequence[Math.min(call, scanSequence.length - 1)];
    call += 1;
    return Promise.resolve({ data: { id: 'upload-1', ...next } });
  });
}

describe('uploadVerificationDocument', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.resetModules();
    postMock.mockReset();
    getMock.mockReset();
    FakeXMLHttpRequest.instances = [];
  });

  it('uploads, waits for a clean scan, and attaches it under the given document key', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXMLHttpRequest);
    mockHappyPathUntilScan([{ status: 'clean' }]);
    const attached = {
      id: 'doc-1',
      documentKey: 'id_card',
      mimeType: 'application/pdf',
      virusScanStatus: 'clean',
      uploadedAt: '2026-01-01T00:00:00.000Z',
    };
    postMock.mockImplementation((url: string) => {
      if (url === '/v1/uploads') return Promise.resolve({ data: CREATE_RESPONSE });
      if (url === '/v1/uploads/{id}/complete')
        return Promise.resolve({ data: { id: 'upload-1', status: 'scanning' } });
      if (url === '/v1/me/verification-case/documents') return Promise.resolve({ data: attached });
      throw new Error(`unexpected POST ${url}`);
    });

    const { uploadVerificationDocument } = await importVerificationDocumentUpload();
    const stages: string[] = [];
    const progress: number[] = [];
    const promise = uploadVerificationDocument(
      fakeFile('a.pdf', 'application/pdf', 10),
      'id_card',
      {
        onProgress: (percent) => progress.push(percent),
        onStageChange: (stage) => stages.push(stage),
      },
    );

    await vi.advanceTimersByTimeAsync(0);
    const xhr = latestXhr();
    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 10, total: 10 });
    xhr.respondSuccess();

    await vi.advanceTimersByTimeAsync(5000);

    const result = await promise;
    expect(result).toEqual(attached);
    expect(progress).toEqual([100]);
    expect(stages).toEqual(['uploading', 'scanning', 'attaching']);
    expect(postMock).toHaveBeenCalledWith('/v1/me/verification-case/documents', {
      body: { uploadId: 'upload-1', documentKey: 'id_card' },
    });
  });

  it('throws an infected error and stops polling once the scan flags the file', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXMLHttpRequest);
    mockHappyPathUntilScan([{ status: 'infected' }]);

    const { uploadVerificationDocument, VerificationDocumentUploadError } =
      await importVerificationDocumentUpload();
    const promise = uploadVerificationDocument(
      fakeFile('a.pdf', 'application/pdf', 10),
      'id_card',
      {
        onProgress: () => undefined,
        onStageChange: () => undefined,
      },
    );
    const rejectionPromise = promise.catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(0);
    latestXhr().respondSuccess();

    const rejection: unknown = await rejectionPromise;
    expect(rejection).toBeInstanceOf(VerificationDocumentUploadError);
    expect((rejection as InstanceType<typeof VerificationDocumentUploadError>).kind).toBe(
      'infected',
    );
  });

  it('throws an apiError when attaching the scanned upload is rejected', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXMLHttpRequest);
    mockHappyPathUntilScan([{ status: 'clean' }]);
    postMock.mockImplementation((url: string) => {
      if (url === '/v1/uploads') return Promise.resolve({ data: CREATE_RESPONSE });
      if (url === '/v1/uploads/{id}/complete')
        return Promise.resolve({ data: { id: 'upload-1', status: 'scanning' } });
      if (url === '/v1/me/verification-case/documents')
        return Promise.resolve({ data: undefined, error: { code: 'UNPROCESSABLE_ENTITY' } });
      throw new Error(`unexpected POST ${url}`);
    });

    const { uploadVerificationDocument, VerificationDocumentUploadError } =
      await importVerificationDocumentUpload();
    const promise = uploadVerificationDocument(
      fakeFile('a.pdf', 'application/pdf', 10),
      'id_card',
      {
        onProgress: () => undefined,
        onStageChange: () => undefined,
      },
    );

    await vi.advanceTimersByTimeAsync(0);
    latestXhr().respondSuccess();

    const rejection: unknown = await promise.catch((error: unknown) => error);
    expect(rejection).toBeInstanceOf(VerificationDocumentUploadError);
    expect((rejection as InstanceType<typeof VerificationDocumentUploadError>).apiError).toEqual({
      code: 'UNPROCESSABLE_ENTITY',
    });
  });

  it('throws an apiError when the PUT itself fails', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXMLHttpRequest);
    postMock.mockResolvedValue({ data: CREATE_RESPONSE });

    const { uploadVerificationDocument, VerificationDocumentUploadError } =
      await importVerificationDocumentUpload();
    const promise = uploadVerificationDocument(
      fakeFile('a.pdf', 'application/pdf', 10),
      'id_card',
      {
        onProgress: () => undefined,
        onStageChange: () => undefined,
      },
    );

    await vi.advanceTimersByTimeAsync(0);
    latestXhr().respondError(500);

    await expect(promise).rejects.toBeInstanceOf(VerificationDocumentUploadError);
  });
});
