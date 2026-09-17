import { createServer, type Server } from 'node:net';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { eicarTestString } from '../testing/eicar.js';
import { startFakeClamdServer, type FakeClamdServer } from '../testing/fake-clamd-server.js';
import { scanStream } from './clamd-client.js';

const DEFAULT_OPTIONS = { host: '127.0.0.1', maxBytes: 1024 * 1024, timeoutMs: 2000 };

describe('scanStream against a fake clamd', () => {
  let server: FakeClamdServer | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it('resolves clean on an OK reply', async () => {
    server = await startFakeClamdServer(() => 'stream: OK\0');
    const result = await scanStream(Readable.from([Buffer.from('hello world')]), {
      ...DEFAULT_OPTIONS,
      port: server.port,
    });
    expect(result).toEqual({ status: 'clean' });
  });

  it('resolves infected with the signature on a FOUND reply', async () => {
    server = await startFakeClamdServer(() => 'stream: Win.Test.EICAR_HDB-1 FOUND\0');
    const result = await scanStream(Readable.from([Buffer.from(eicarTestString())]), {
      ...DEFAULT_OPTIONS,
      port: server.port,
    });
    expect(result).toEqual({ status: 'infected', signature: 'Win.Test.EICAR_HDB-1' });
  });

  it('rejects on an unrecognised reply', async () => {
    server = await startFakeClamdServer(() => 'stream: something odd\0');
    await expect(
      scanStream(Readable.from([Buffer.from('data')]), { ...DEFAULT_OPTIONS, port: server.port }),
    ).rejects.toThrow(/unexpected clamd response/);
  });

  it('rejects when clamd never replies before the timeout', async () => {
    const silentServer: Server = createServer((socket) => {
      socket.on('data', () => undefined);
    });
    await new Promise<void>((resolve) => silentServer.listen(0, '127.0.0.1', resolve));
    const address = silentServer.address();
    if (!address || typeof address === 'string') {
      throw new Error('silent test server has no port');
    }

    try {
      await expect(
        scanStream(Readable.from([Buffer.from('data')]), {
          ...DEFAULT_OPTIONS,
          port: address.port,
          timeoutMs: 100,
        }),
      ).rejects.toThrow(/timed out/);
    } finally {
      await new Promise<void>((resolve) =>
        silentServer.close(() => {
          resolve();
        }),
      );
    }
  });

  it('rejects when the object exceeds the configured size cap', async () => {
    server = await startFakeClamdServer(() => 'stream: OK\0');
    const bigChunk = Buffer.alloc(2048, 'a');
    await expect(
      scanStream(Readable.from([bigChunk]), {
        ...DEFAULT_OPTIONS,
        port: server.port,
        maxBytes: 1024,
      }),
    ).rejects.toThrow(/size cap/);
  });

  it('settles only once when two oversized chunks arrive back to back', async () => {
    server = await startFakeClamdServer(() => 'stream: OK\0');
    const chunks = [Buffer.alloc(2048, 'a'), Buffer.alloc(2048, 'b')];
    await expect(
      scanStream(Readable.from(chunks), { ...DEFAULT_OPTIONS, port: server.port, maxBytes: 1024 }),
    ).rejects.toThrow(/size cap/);
  });

  it('rejects when the connection cannot be established', async () => {
    await expect(
      scanStream(Readable.from([Buffer.from('data')]), {
        ...DEFAULT_OPTIONS,
        port: 1,
        timeoutMs: 2000,
      }),
    ).rejects.toThrow();
  });

  it('rejects when the source stream itself errors mid-read', async () => {
    server = await startFakeClamdServer(() => 'stream: OK\0');
    const source = new Readable({ read: () => undefined });
    source.push('partial');

    const resultPromise = scanStream(source, { ...DEFAULT_OPTIONS, port: server.port });
    await new Promise((resolve) => setTimeout(resolve, 20));
    source.destroy(new Error('source read failed'));

    await expect(resultPromise).rejects.toThrow('source read failed');
  });
});
