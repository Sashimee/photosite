import { Writable } from 'node:stream';
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { buildPinoHttpOptions } from './logger.options.js';

function collectLogs(): { stream: Writable; lines: () => unknown[] } {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      chunks.push(chunk.toString('utf8'));
      callback();
    },
  });
  return {
    stream,
    lines: () =>
      chunks
        .join('')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as unknown),
  };
}

function getRedact(): NonNullable<ReturnType<typeof buildPinoHttpOptions>['redact']> {
  const { redact } = buildPinoHttpOptions();
  if (!redact) {
    throw new Error('buildPinoHttpOptions() must configure redact');
  }
  return redact;
}

function callGenReqId(request: unknown): string {
  const { genReqId } = buildPinoHttpOptions();
  if (!genReqId) {
    throw new Error('buildPinoHttpOptions() must configure genReqId');
  }
  return String((genReqId as unknown as (req: unknown) => string | number)(request));
}

describe('buildPinoHttpOptions redaction', () => {
  it('redacts authorization and cookie headers', () => {
    const { stream, lines } = collectLogs();
    const logger = pino({ redact: getRedact() }, stream);

    logger.info({
      req: { headers: { authorization: 'Bearer secret-token', cookie: 'session=abc' } },
    });

    const [line] = lines() as [{ req: { headers: { authorization: string; cookie: string } } }];
    expect(line.req.headers.authorization).toBe('[Redacted]');
    expect(line.req.headers.cookie).toBe('[Redacted]');
  });

  it('redacts a top-level password, token or secret field', () => {
    const { stream, lines } = collectLogs();
    const logger = pino({ redact: getRedact() }, stream);

    logger.info({ password: 'hunter2', token: 'abc.def.ghi', secret: 'shh', name: 'ok' });

    const [line] = lines() as [{ password: string; token: string; secret: string; name: string }];
    expect(line.password).toBe('[Redacted]');
    expect(line.token).toBe('[Redacted]');
    expect(line.secret).toBe('[Redacted]');
    expect(line.name).toBe('ok');
  });

  it('redacts a set-cookie response header', () => {
    const { stream, lines } = collectLogs();
    const logger = pino({ redact: getRedact() }, stream);

    logger.info({ res: { headers: { 'set-cookie': 'session=abc; HttpOnly' } } });

    const [line] = lines() as [{ res: { headers: { 'set-cookie': string } } }];
    expect(line.res.headers['set-cookie']).toBe('[Redacted]');
  });
});

describe('buildPinoHttpOptions genReqId', () => {
  it('reuses an existing request id', () => {
    expect(callGenReqId({ id: 'existing-id' })).toBe('existing-id');
  });

  it('falls back to req.raw.id when req.id is missing', () => {
    expect(callGenReqId({ raw: { id: 'raw-id' } })).toBe('raw-id');
  });

  it('generates a fresh id when neither is present', () => {
    const id = callGenReqId({});
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });
});
