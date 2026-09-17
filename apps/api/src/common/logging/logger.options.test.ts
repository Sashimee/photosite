import { Writable } from 'node:stream';
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { buildPinoHttpOptions, sanitizeLoggedUrl } from './logger.options.js';

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

  it('redacts nested verification/reset token material one level deep', () => {
    const { stream, lines } = collectLogs();
    const logger = pino({ redact: getRedact() }, stream);

    logger.info({
      body: {
        code: '123456',
        backupCode: 'abcde-12345',
        backupCodes: ['abcde-12345'],
        newPassword: 'x',
        currentPassword: 'y',
        url: 'https://api.photoo.lu/v1/auth/reset-password/SECRET?callbackURL=%2F',
        otpauthUrl: 'otpauth://totp/x?secret=SECRET',
        email: 'kept@example.com',
      },
    });

    const [line] = lines() as [{ body: Record<string, unknown> }];
    expect(line.body.code).toBe('[Redacted]');
    expect(line.body.backupCode).toBe('[Redacted]');
    expect(line.body.backupCodes).toBe('[Redacted]');
    expect(line.body.newPassword).toBe('[Redacted]');
    expect(line.body.currentPassword).toBe('[Redacted]');
    expect(line.body.url).toBe('[Redacted]');
    expect(line.body.otpauthUrl).toBe('[Redacted]');
    expect(line.body.email).toBe('kept@example.com');
  });

  it('redacts a presigned upload URL logged as body.url or presignedUrl', () => {
    const { stream, lines } = collectLogs();
    const logger = pino({ redact: getRedact() }, stream);

    logger.info({
      body: {
        url: 'https://storage.photoo.lu/photoo-private/u/abc?X-Amz-Signature=secret',
      },
    });
    logger.info({
      presignedUrl: 'https://storage.photoo.lu/photoo-private/u/abc?X-Amz-Signature=secret',
      upload: {
        presignedUrl: 'https://storage.photoo.lu/photoo-public/v/abc?X-Amz-Signature=secret',
      },
    });

    const [bodyLine, presignedLine] = lines() as [
      { body: { url: string } },
      { presignedUrl: string; upload: { presignedUrl: string } },
    ];
    expect(bodyLine.body.url).toBe('[Redacted]');
    expect(presignedLine.presignedUrl).toBe('[Redacted]');
    expect(presignedLine.upload.presignedUrl).toBe('[Redacted]');
  });
});

describe('sanitizeLoggedUrl', () => {
  it('strips the query string from a verify-email link', () => {
    expect(
      sanitizeLoggedUrl('/v1/auth/verify-email?token=SYNTHETIC-TOKEN-123&callbackURL=%2F'),
    ).toBe('/v1/auth/verify-email');
  });

  it('masks the token path segment of a reset-password link', () => {
    expect(
      sanitizeLoggedUrl('/v1/auth/reset-password/SYNTHETIC-RESET-TOKEN-456?callbackURL=%2F'),
    ).toBe('/v1/auth/reset-password/[Redacted]');
  });

  it('leaves an ordinary path untouched', () => {
    expect(sanitizeLoggedUrl('/v1/auth/session')).toBe('/v1/auth/session');
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
