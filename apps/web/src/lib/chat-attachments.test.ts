import { afterEach, describe, expect, it, vi } from 'vitest';

const postMock = vi.fn();
vi.mock('./api', () => ({ api: { POST: postMock } }));

class FakeXMLHttpRequest {
  static instances: FakeXMLHttpRequest[] = [];
  status = 0;
  upload = {
    onprogress: null as
      ((event: { lengthComputable: boolean; loaded: number; total: number }) => void) | null,
  };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private headers: Record<string, string> = {};
  private body: unknown;
  method = '';
  url = '';

  constructor() {
    FakeXMLHttpRequest.instances.push(this);
  }

  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(key: string, value: string) {
    this.headers[key] = value;
  }

  send(body: unknown) {
    this.body = body;
  }

  respondSuccess(status = 200) {
    this.status = status;
    this.onload?.();
  }

  respondError(status = 500) {
    this.status = status;
    this.onload?.();
  }

  fail() {
    this.onerror?.();
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

async function importAttachments() {
  return import('./chat-attachments');
}

describe('uploadChatAttachment', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    postMock.mockReset();
    FakeXMLHttpRequest.instances = [];
  });

  it('requests an upload, PUTs the file and confirms completion', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXMLHttpRequest);
    postMock.mockImplementation((url: string) => {
      if (url === '/v1/uploads') {
        return Promise.resolve({
          data: {
            uploadId: 'upload-1',
            url: 'https://storage.example/upload-1',
            headers: { 'Content-Type': 'image/png', 'Content-Length': '10' },
            expiresAt: '2026-01-01T00:00:00.000Z',
          },
        });
      }
      if (url === '/v1/uploads/{id}/complete') {
        return Promise.resolve({ data: { id: 'upload-1', status: 'scanning' } });
      }
      throw new Error(`unexpected POST ${url}`);
    });
    const { uploadChatAttachment } = await importAttachments();

    const progress: number[] = [];
    const promise = uploadChatAttachment(fakeFile('a.png', 'image/png', 10), (percent) => {
      progress.push(percent);
    });

    await Promise.resolve();
    await Promise.resolve();
    const xhr = latestXhr();
    expect(xhr.method).toBe('PUT');
    expect(xhr.url).toBe('https://storage.example/upload-1');
    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 5, total: 10 });
    xhr.respondSuccess();

    const result = await promise;
    expect(result).toEqual({ uploadId: 'upload-1' });
    expect(progress).toEqual([50]);
  });

  it('throws when requesting the presigned URL fails', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXMLHttpRequest);
    postMock.mockResolvedValue({ data: undefined, error: { code: 'UNPROCESSABLE_ENTITY' } });
    const { uploadChatAttachment, ChatAttachmentError } = await importAttachments();

    await expect(
      uploadChatAttachment(fakeFile('a.png', 'image/png', 10), () => undefined),
    ).rejects.toBeInstanceOf(ChatAttachmentError);
  });

  it('throws when the PUT itself fails', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXMLHttpRequest);
    postMock.mockResolvedValue({
      data: {
        uploadId: 'upload-1',
        url: 'https://storage.example/upload-1',
        headers: { 'Content-Type': 'image/png', 'Content-Length': '10' },
        expiresAt: '2026-01-01T00:00:00.000Z',
      },
    });
    const { uploadChatAttachment, ChatAttachmentError } = await importAttachments();

    const promise = uploadChatAttachment(fakeFile('a.png', 'image/png', 10), () => undefined);
    await Promise.resolve();
    await Promise.resolve();
    latestXhr().respondError(500);

    await expect(promise).rejects.toBeInstanceOf(ChatAttachmentError);
  });

  it('throws when confirming the upload fails', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXMLHttpRequest);
    postMock.mockImplementation((url: string) => {
      if (url === '/v1/uploads') {
        return Promise.resolve({
          data: {
            uploadId: 'upload-1',
            url: 'https://storage.example/upload-1',
            headers: { 'Content-Type': 'image/png', 'Content-Length': '10' },
            expiresAt: '2026-01-01T00:00:00.000Z',
          },
        });
      }
      return Promise.resolve({ data: undefined, error: { code: 'CONFLICT' } });
    });
    const { uploadChatAttachment, ChatAttachmentError } = await importAttachments();

    const promise = uploadChatAttachment(fakeFile('a.png', 'image/png', 10), () => undefined);
    await Promise.resolve();
    await Promise.resolve();
    latestXhr().respondSuccess();

    await expect(promise).rejects.toBeInstanceOf(ChatAttachmentError);
  });
});
