import { jest } from '@jest/globals';

export interface RecordedPut {
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

export function installFakeFetch(sizeByUri: Record<string, number>) {
  const fetchMock = jest.fn((uri: string) =>
    Promise.resolve({ blob: () => Promise.resolve({ size: sizeByUri[uri] ?? 1024 }) }),
  );
  Object.assign(globalThis, { fetch: fetchMock });
  return fetchMock;
}

export function installFakeXhr() {
  const puts: RecordedPut[] = [];
  let nextStatus = 200;

  class FakeXhr {
    status = 0;
    upload: { onprogress: ((event: unknown) => void) | null } = { onprogress: null };
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    private url = '';
    private headers: Record<string, string> = {};

    open(_method: string, url: string) {
      this.url = url;
    }

    setRequestHeader(key: string, value: string) {
      this.headers[key] = value;
    }

    send(body: unknown) {
      puts.push({ url: this.url, headers: this.headers, body });
      this.upload.onprogress?.({ lengthComputable: true, loaded: 50, total: 100 });
      this.status = nextStatus;
      this.onload?.();
    }
  }

  Object.assign(globalThis, { XMLHttpRequest: FakeXhr });
  return {
    puts,
    failNextWith(status: number) {
      nextStatus = status;
    },
    reset() {
      puts.length = 0;
      nextStatus = 200;
    },
  };
}
