import type { EmailJob } from '@photoo/shared';
import type { Job } from 'bullmq';
import type { Logger } from 'nestjs-pino';
import { describe, expect, it, vi } from 'vitest';
import { createEmailProcessor } from './email.processor.js';
import type { MailMessage } from '../../email/mail-transport.js';

function fakeLogger(): Logger {
  return { log: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger;
}

describe('createEmailProcessor', () => {
  it('renders and sends a verify-email job through the mail transport', async () => {
    const sendMail = vi.fn<(message: MailMessage) => Promise<void>>(() => Promise.resolve());
    const processor = createEmailProcessor({ mailTransport: { sendMail }, logger: fakeLogger() });

    const job = {
      data: {
        type: 'verify-email',
        to: 'jane@example.com',
        url: 'https://photoo.lu/en/verify-email#token=abc',
      },
    } as Job<EmailJob>;

    await processor(job, undefined, undefined);

    expect(sendMail).toHaveBeenCalledTimes(1);
    const message = sendMail.mock.calls[0]?.[0];
    expect(message?.to).toBe('jane@example.com');
    expect(message?.text).toContain('https://photoo.lu/en/verify-email#token=abc');
  });

  it('rejects a malformed job payload', async () => {
    const processor = createEmailProcessor({
      mailTransport: { sendMail: vi.fn<(message: MailMessage) => Promise<void>>() },
      logger: fakeLogger(),
    });

    const malformed = { data: { type: 'unknown' } } as unknown as Job<EmailJob>;
    await expect(processor(malformed, undefined, undefined)).rejects.toThrow();
  });
});
