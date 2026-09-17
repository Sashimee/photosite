import { describe, expect, it, vi } from 'vitest';

const sendMail = vi.fn(() => Promise.resolve());
const createTransport = vi.fn(() => ({ sendMail }));

vi.mock('nodemailer', () => ({ default: { createTransport } }));

describe('createMailTransport', () => {
  it('configures nodemailer without auth when no credentials are given', async () => {
    const { createMailTransport } = await import('./mail-transport.js');
    createMailTransport({
      SMTP_HOST: 'localhost',
      SMTP_PORT: 1025,
      SMTP_SECURE: false,
      SMTP_FROM: 'dev@photoo.test',
    });

    expect(createTransport).toHaveBeenCalledWith({
      host: 'localhost',
      port: 1025,
      secure: false,
      auth: undefined,
    });
  });

  it('configures nodemailer auth when user and password are given', async () => {
    const { createMailTransport } = await import('./mail-transport.js');
    createMailTransport({
      SMTP_HOST: 'smtp-relay.brevo.com',
      SMTP_PORT: 587,
      SMTP_SECURE: false,
      SMTP_USER: 'apikey',
      SMTP_PASSWORD: 'secret',
      SMTP_FROM: 'no-reply@photoo.lu',
    });

    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ auth: { user: 'apikey', pass: 'secret' } }),
    );
  });

  it('sends through the transport with the configured from address', async () => {
    const { createMailTransport } = await import('./mail-transport.js');
    const transport = createMailTransport({
      SMTP_HOST: 'localhost',
      SMTP_PORT: 1025,
      SMTP_SECURE: false,
      SMTP_FROM: 'dev@photoo.test',
    });

    await transport.sendMail({
      to: 'jane@example.com',
      subject: 'Hi',
      text: 'hi',
      html: '<p>hi</p>',
    });

    expect(sendMail).toHaveBeenCalledWith({
      from: 'dev@photoo.test',
      to: 'jane@example.com',
      subject: 'Hi',
      text: 'hi',
      html: '<p>hi</p>',
    });
  });
});
