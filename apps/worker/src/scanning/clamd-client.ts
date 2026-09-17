import { connect } from 'node:net';
import type { Readable } from 'node:stream';

export interface ClamdScanClean {
  status: 'clean';
}

export interface ClamdScanInfected {
  status: 'infected';
  signature: string;
}

export type ClamdScanResult = ClamdScanClean | ClamdScanInfected;

export interface ClamdScanOptions {
  host: string;
  port: number;
  maxBytes: number;
  timeoutMs: number;
}

const FOUND_PATTERN = /:\s*(.+?)\s+FOUND$/;

// Wire format is clamd's INSTREAM protocol
// (https://docs.clamav.net/manual/Usage/Scanning.html#instream): a 4-byte
// big-endian length must precede every chunk, and a zero-length chunk is
// the only way to signal end-of-stream to clamd.
export function scanStream(stream: Readable, options: ClamdScanOptions): Promise<ClamdScanResult> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: options.host, port: options.port });
    let responseBuffer = '';
    let bytesSent = 0;
    let settled = false;

    const timeout = setTimeout(() => {
      fail(new Error(`clamd scan timed out after ${String(options.timeoutMs)}ms`));
    }, options.timeoutMs);

    function cleanup(): void {
      clearTimeout(timeout);
      stream.removeAllListeners('data');
      stream.removeAllListeners('end');
      stream.removeAllListeners('error');
    }

    function fail(err: Error): void {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      socket.destroy();
      stream.destroy();
      reject(err);
    }

    function succeed(result: ClamdScanResult): void {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      socket.end();
      resolve(result);
    }

    socket.on('error', (err) => {
      fail(err);
    });

    socket.on('connect', () => {
      socket.write('zINSTREAM\0');

      stream.on('data', (chunk: Buffer) => {
        bytesSent += chunk.length;
        if (bytesSent > options.maxBytes) {
          fail(
            new Error(
              `object exceeds the clamd scan size cap of ${String(options.maxBytes)} bytes`,
            ),
          );
          return;
        }
        const lengthPrefix = Buffer.alloc(4);
        lengthPrefix.writeUInt32BE(chunk.length, 0);
        socket.write(Buffer.concat([lengthPrefix, chunk]));
      });

      stream.on('error', (err) => {
        fail(err);
      });

      stream.on('end', () => {
        socket.write(Buffer.alloc(4, 0));
      });
    });

    socket.on('data', (chunk: Buffer) => {
      responseBuffer += chunk.toString('utf8');
    });

    socket.on('close', () => {
      if (settled) {
        return;
      }
      const reply = responseBuffer.replace(/\0/g, '').trim();
      if (reply.endsWith('OK')) {
        succeed({ status: 'clean' });
        return;
      }
      const found = FOUND_PATTERN.exec(reply);
      if (found) {
        succeed({ status: 'infected', signature: found[1] ?? 'unknown' });
        return;
      }
      fail(new Error(`unexpected clamd response: ${reply || '(empty)'}`));
    });
  });
}
