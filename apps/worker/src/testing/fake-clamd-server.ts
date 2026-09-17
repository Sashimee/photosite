import { createServer, type Server, type Socket } from 'node:net';

export type FakeClamdReply = (payload: Buffer) => string;

export interface FakeClamdServer {
  port: number;
  close: () => Promise<void>;
}

// Speaks just enough of clamd's INSTREAM wire protocol to drive
// scanStream()'s parser: reads length-prefixed chunks until the zero-length
// terminator, then hands the reassembled payload to `reply` to decide what
// to send back (e.g. "stream: OK\0" or "stream: EICAR FOUND\0").
export function startFakeClamdServer(reply: FakeClamdReply): Promise<FakeClamdServer> {
  return new Promise((resolve, reject) => {
    const server: Server = createServer((socket: Socket) => {
      let buffer = Buffer.alloc(0);
      let sawCommand = false;
      const chunks: Buffer[] = [];

      socket.on('data', (data: Buffer) => {
        buffer = Buffer.concat([buffer, data]);

        if (!sawCommand) {
          const commandEnd = buffer.indexOf(0);
          if (commandEnd === -1) {
            return;
          }
          sawCommand = true;
          buffer = buffer.subarray(commandEnd + 1);
        }

        for (;;) {
          if (buffer.length < 4) {
            return;
          }
          const length = buffer.readUInt32BE(0);
          if (buffer.length < 4 + length) {
            return;
          }
          if (length === 0) {
            socket.end(reply(Buffer.concat(chunks)));
            return;
          }
          chunks.push(buffer.subarray(4, 4 + length));
          buffer = buffer.subarray(4 + length);
        }
      });
    });

    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('fake clamd server has no port'));
        return;
      }
      resolve({
        port: address.port,
        close: () =>
          new Promise((resolveClose) => {
            server.close(() => {
              resolveClose();
            });
          }),
      });
    });
  });
}
