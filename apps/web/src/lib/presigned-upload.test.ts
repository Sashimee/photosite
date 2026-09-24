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
  headers: { 'Content-Type': 'image/jpeg', 'Content-Length': '10' },
  expiresAt: '2026-01-01T00:00:00.000Z',
};

async function importPresignedUpload() {
  return import('./presigned-upload');
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

describe('uploadAndScanFile', () => {
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

  it('uploads and resolves once the scan comes back clean, reporting each purpose and stage', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXMLHttpRequest);
    mockHappyPathUntilScan([{ status: 'scanning' }, { status: 'clean' }]);

    const { uploadAndScanFile } = await importPresignedUpload();
    const stages: string[] = [];
    const progress: number[] = [];
    const promise = uploadAndScanFile(fakeFile('logo.jpg', 'image/jpeg', 10), 'logo', {
      onProgress: (percent) => progress.push(percent),
      onStageChange: (stage) => stages.push(stage),
    });

    await vi.advanceTimersByTimeAsync(0);
    const xhr = latestXhr();
    expect(postMock.mock.calls[0]?.[1]).toMatchObject({
      body: { purpose: 'logo', mimeType: 'image/jpeg', sizeBytes: 10 },
    });
    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 10, total: 10 });
    xhr.respondSuccess();

    await vi.advanceTimersByTimeAsync(5000);

    const result = await promise;
    expect(result).toEqual({ id: 'upload-1', status: 'clean' });
    expect(progress).toEqual([100]);
    expect(stages).toEqual(['uploading', 'scanning']);
  });

  it('resolves with a processed upload too', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXMLHttpRequest);
    mockHappyPathUntilScan([{ status: 'processed' }]);

    const { uploadAndScanFile } = await importPresignedUpload();
    const promise = uploadAndScanFile(fakeFile('logo.jpg', 'image/jpeg', 10), 'logo', {
      onProgress: () => undefined,
      onStageChange: () => undefined,
    });

    await vi.advanceTimersByTimeAsync(0);
    latestXhr().respondSuccess();

    expect(await promise).toEqual({ id: 'upload-1', status: 'processed' });
  });

  it('throws an infected error and stops polling once the scan flags the file', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXMLHttpRequest);
    mockHappyPathUntilScan([{ status: 'infected' }]);

    const { uploadAndScanFile, PresignedUploadError } = await importPresignedUpload();
    const promise = uploadAndScanFile(fakeFile('logo.jpg', 'image/jpeg', 10), 'logo', {
      onProgress: () => undefined,
      onStageChange: () => undefined,
    });
    const rejectionPromise = promise.catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(0);
    latestXhr().respondSuccess();

    const rejection: unknown = await rejectionPromise;
    expect(rejection).toBeInstanceOf(PresignedUploadError);
    expect((rejection as InstanceType<typeof PresignedUploadError>).kind).toBe('infected');
  });

  it('throws a scanFailed error when the scan cannot complete', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXMLHttpRequest);
    mockHappyPathUntilScan([{ status: 'failed' }]);

    const { uploadAndScanFile, PresignedUploadError } = await importPresignedUpload();
    const promise = uploadAndScanFile(fakeFile('logo.jpg', 'image/jpeg', 10), 'logo', {
      onProgress: () => undefined,
      onStageChange: () => undefined,
    });
    const rejectionPromise = promise.catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(0);
    latestXhr().respondSuccess();

    const rejection: unknown = await rejectionPromise;
    expect(rejection).toBeInstanceOf(PresignedUploadError);
    expect((rejection as InstanceType<typeof PresignedUploadError>).kind).toBe('scanFailed');
  });

  it('throws a scanTimeout error when the scan never finishes in time', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXMLHttpRequest);
    mockHappyPathUntilScan([{ status: 'scanning' }]);

    const { uploadAndScanFile, PresignedUploadError } = await importPresignedUpload();
    const promise = uploadAndScanFile(fakeFile('logo.jpg', 'image/jpeg', 10), 'logo', {
      onProgress: () => undefined,
      onStageChange: () => undefined,
    });
    const rejectionPromise = promise.catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(0);
    latestXhr().respondSuccess();
    await vi.advanceTimersByTimeAsync(120_000);

    const rejection: unknown = await rejectionPromise;
    expect(rejection).toBeInstanceOf(PresignedUploadError);
    expect((rejection as InstanceType<typeof PresignedUploadError>).kind).toBe('scanTimeout');
  });

  it('throws an apiError when the presigned request fails', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXMLHttpRequest);
    postMock.mockResolvedValue({ data: undefined, error: { code: 'UNPROCESSABLE_ENTITY' } });

    const { uploadAndScanFile, PresignedUploadError } = await importPresignedUpload();
    const rejection: unknown = await uploadAndScanFile(
      fakeFile('logo.jpg', 'image/jpeg', 10),
      'logo',
      { onProgress: () => undefined, onStageChange: () => undefined },
    ).catch((error: unknown) => error);

    expect(rejection).toBeInstanceOf(PresignedUploadError);
    expect((rejection as InstanceType<typeof PresignedUploadError>).kind).toBe('apiError');
  });

  it('throws an apiError when the PUT itself fails', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXMLHttpRequest);
    postMock.mockResolvedValue({ data: CREATE_RESPONSE });

    const { uploadAndScanFile, PresignedUploadError } = await importPresignedUpload();
    const promise = uploadAndScanFile(fakeFile('logo.jpg', 'image/jpeg', 10), 'logo', {
      onProgress: () => undefined,
      onStageChange: () => undefined,
    });

    await vi.advanceTimersByTimeAsync(0);
    latestXhr().respondError(500);

    await expect(promise).rejects.toBeInstanceOf(PresignedUploadError);
  });

  it('throws an apiError when confirming the upload fails', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXMLHttpRequest);
    postMock.mockImplementation((url: string) => {
      if (url === '/v1/uploads') return Promise.resolve({ data: CREATE_RESPONSE });
      if (url === '/v1/uploads/{id}/complete')
        return Promise.resolve({ data: undefined, error: { code: 'NOT_FOUND' } });
      throw new Error(`unexpected POST ${url}`);
    });

    const { uploadAndScanFile, PresignedUploadError } = await importPresignedUpload();
    const promise = uploadAndScanFile(fakeFile('logo.jpg', 'image/jpeg', 10), 'logo', {
      onProgress: () => undefined,
      onStageChange: () => undefined,
    });

    await vi.advanceTimersByTimeAsync(0);
    latestXhr().respondSuccess();

    await expect(promise).rejects.toBeInstanceOf(PresignedUploadError);
  });
});
