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

async function importPortfolioUpload() {
  return import('./portfolio-upload');
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

describe('uploadPortfolioImage', () => {
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

  it('uploads, waits for a clean scan, and attaches the image', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXMLHttpRequest);
    mockHappyPathUntilScan([{ status: 'scanning' }, { status: 'scanning' }, { status: 'clean' }]);
    const attached = {
      id: 'image-1',
      url: 'https://cdn.example/image-1.jpg',
      width: 100,
      height: 100,
      order: 1,
      status: 'processing',
      provenance: null,
    };
    postMock.mockImplementation((url: string) => {
      if (url === '/v1/uploads') return Promise.resolve({ data: CREATE_RESPONSE });
      if (url === '/v1/uploads/{id}/complete')
        return Promise.resolve({ data: { id: 'upload-1', status: 'scanning' } });
      if (url === '/v1/me/photographer-profile/portfolio')
        return Promise.resolve({ data: attached });
      throw new Error(`unexpected POST ${url}`);
    });

    const { uploadPortfolioImage } = await importPortfolioUpload();
    const stages: string[] = [];
    const progress: number[] = [];
    const promise = uploadPortfolioImage(fakeFile('a.jpg', 'image/jpeg', 10), {
      onProgress: (percent) => progress.push(percent),
      onStageChange: (stage) => stages.push(stage),
    });

    await vi.advanceTimersByTimeAsync(0);
    const xhr = latestXhr();
    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 10, total: 10 });
    xhr.respondSuccess();

    await vi.advanceTimersByTimeAsync(5000);

    const result = await promise;
    expect(result).toEqual(attached);
    expect(progress).toEqual([100]);
    expect(stages).toEqual(['uploading', 'scanning', 'attaching']);
  });

  it('throws an infected error and stops polling once the scan flags the file', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXMLHttpRequest);
    mockHappyPathUntilScan([{ status: 'infected' }]);

    const { uploadPortfolioImage, PortfolioUploadError } = await importPortfolioUpload();
    const promise = uploadPortfolioImage(fakeFile('a.jpg', 'image/jpeg', 10), {
      onProgress: () => undefined,
      onStageChange: () => undefined,
    });
    // Caught immediately, not after `advanceTimersByTimeAsync`: the fake
    // clock can flush the rejection before a later `.catch` attaches,
    // which Node reports as an unhandled rejection even though it is
    // handled a tick later.
    const rejectionPromise = promise.catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(0);
    latestXhr().respondSuccess();

    const rejection: unknown = await rejectionPromise;
    expect(rejection).toBeInstanceOf(PortfolioUploadError);
    expect((rejection as InstanceType<typeof PortfolioUploadError>).kind).toBe('infected');
  });

  it('throws a scanTimeout error when the scan never finishes in time', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXMLHttpRequest);
    mockHappyPathUntilScan([{ status: 'scanning' }]);

    const { uploadPortfolioImage, PortfolioUploadError } = await importPortfolioUpload();
    const promise = uploadPortfolioImage(fakeFile('a.jpg', 'image/jpeg', 10), {
      onProgress: () => undefined,
      onStageChange: () => undefined,
    });
    const rejectionPromise = promise.catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(0);
    latestXhr().respondSuccess();
    await vi.advanceTimersByTimeAsync(120_000);

    const rejection: unknown = await rejectionPromise;
    expect(rejection).toBeInstanceOf(PortfolioUploadError);
    expect((rejection as InstanceType<typeof PortfolioUploadError>).kind).toBe('scanTimeout');
  });

  it('throws an apiError when the presigned request fails', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXMLHttpRequest);
    postMock.mockResolvedValue({ data: undefined, error: { code: 'UNPROCESSABLE_ENTITY' } });

    const { uploadPortfolioImage, PortfolioUploadError } = await importPortfolioUpload();
    const rejection: unknown = await uploadPortfolioImage(fakeFile('a.jpg', 'image/jpeg', 10), {
      onProgress: () => undefined,
      onStageChange: () => undefined,
    }).catch((error: unknown) => error);

    expect(rejection).toBeInstanceOf(PortfolioUploadError);
    expect((rejection as InstanceType<typeof PortfolioUploadError>).kind).toBe('apiError');
  });

  it('throws an apiError when attaching the scanned upload is rejected', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXMLHttpRequest);
    mockHappyPathUntilScan([{ status: 'clean' }]);
    postMock.mockImplementation((url: string) => {
      if (url === '/v1/uploads') return Promise.resolve({ data: CREATE_RESPONSE });
      if (url === '/v1/uploads/{id}/complete')
        return Promise.resolve({ data: { id: 'upload-1', status: 'scanning' } });
      if (url === '/v1/me/photographer-profile/portfolio')
        return Promise.resolve({ data: undefined, error: { code: 'CONFLICT' } });
      throw new Error(`unexpected POST ${url}`);
    });

    const { uploadPortfolioImage, PortfolioUploadError } = await importPortfolioUpload();
    const promise = uploadPortfolioImage(fakeFile('a.jpg', 'image/jpeg', 10), {
      onProgress: () => undefined,
      onStageChange: () => undefined,
    });

    await vi.advanceTimersByTimeAsync(0);
    latestXhr().respondSuccess();

    const rejection: unknown = await promise.catch((error: unknown) => error);
    expect(rejection).toBeInstanceOf(PortfolioUploadError);
    expect((rejection as InstanceType<typeof PortfolioUploadError>).apiError).toEqual({
      code: 'CONFLICT',
    });
  });

  it('throws an apiError when the PUT itself fails', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXMLHttpRequest);
    postMock.mockResolvedValue({ data: CREATE_RESPONSE });

    const { uploadPortfolioImage, PortfolioUploadError } = await importPortfolioUpload();
    const promise = uploadPortfolioImage(fakeFile('a.jpg', 'image/jpeg', 10), {
      onProgress: () => undefined,
      onStageChange: () => undefined,
    });

    await vi.advanceTimersByTimeAsync(0);
    latestXhr().respondError(500);

    await expect(promise).rejects.toBeInstanceOf(PortfolioUploadError);
  });
});
