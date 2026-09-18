import { Writable } from 'node:stream';
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { buildPinoOptions } from './logger.options.js';

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

function getRedact(): NonNullable<ReturnType<typeof buildPinoOptions>['redact']> {
  const { redact } = buildPinoOptions();
  if (!redact) {
    throw new Error('buildPinoOptions() must configure redact');
  }
  return redact;
}

describe('buildPinoOptions redaction', () => {
  it('redacts the nodemailer SMTP error fields that carry recipient data', () => {
    const { stream, lines } = collectLogs();
    const logger = pino({ redact: getRedact() }, stream);

    logger.error({
      err: {
        rejected: ['jane@example.com'],
        response: '550 mailbox unavailable',
        envelope: { to: ['jane@example.com'] },
        accepted: ['jane@example.com'],
      },
    });

    const [line] = lines() as [
      { err: { rejected: string; response: string; envelope: string; accepted: string } },
    ];
    expect(line.err.rejected).toBe('[Redacted]');
    expect(line.err.response).toBe('[Redacted]');
    expect(line.err.envelope).toBe('[Redacted]');
    expect(line.err.accepted).toBe('[Redacted]');
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

  it('redacts a consent record ip/userAgent, at top level and one level deep', () => {
    const { stream, lines } = collectLogs();
    const logger = pino({ redact: getRedact() }, stream);

    logger.info({
      ip: '203.0.113.1',
      userAgent: 'Mozilla/5.0',
      consent: { ip: '203.0.113.1', userAgent: 'Mozilla/5.0' },
    });

    const [line] = lines() as [
      { ip: string; userAgent: string; consent: { ip: string; userAgent: string } },
    ];
    expect(line.ip).toBe('[Redacted]');
    expect(line.userAgent).toBe('[Redacted]');
    expect(line.consent.ip).toBe('[Redacted]');
    expect(line.consent.userAgent).toBe('[Redacted]');
  });

  it('redacts a GDPR export key and anonymous consent id, at top level and one level deep', () => {
    const { stream, lines } = collectLogs();
    const logger = pino({ redact: getRedact() }, stream);

    logger.info({
      exportKey: 'gdpr-exports/abc123.zip',
      anonymousId: 'anon-123',
      dataRequest: { exportKey: 'gdpr-exports/abc123.zip', anonymousId: 'anon-123' },
    });

    const [line] = lines() as [
      {
        exportKey: string;
        anonymousId: string;
        dataRequest: { exportKey: string; anonymousId: string };
      },
    ];
    expect(line.exportKey).toBe('[Redacted]');
    expect(line.anonymousId).toBe('[Redacted]');
    expect(line.dataRequest.exportKey).toBe('[Redacted]');
    expect(line.dataRequest.anonymousId).toBe('[Redacted]');
  });
});
