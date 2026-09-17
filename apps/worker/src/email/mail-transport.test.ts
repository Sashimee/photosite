import { describe, expect, it, vi } from 'vitest';

interface FakeTransportOptions {
  host?: string;
  port?: number;
  secure?: boolean;
  auth?: { user: string; pass: string };
  requireTLS?: boolean;
  tls?: { minVersion: string };
}

const sendMail = vi.fn(() => Promise.resolve());
const createTransport = vi.fn<(options: FakeTransportOptions) => { sendMail: typeof sendMail }>(
  () => ({ sendMail }),
);

vi.mock('nodemailer', () => ({ default: { createTransport } }));

describe('createMailTransport', () => {
  it('configures nodemailer without auth when no credentials are given', async () => {
    const { createMailTransport } = await import('./mail-transport.js');
    createMailTransport({
      NODE_ENV: 'development',
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
      NODE_ENV: 'production',
      SMTP_HOST: 'smtp-relay.brevo.com',
      SMTP_PORT: 465,
      SMTP_SECURE: true,
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
      NODE_ENV: 'test',
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

  it('does not force TLS outside production, even over STARTTLS', async () => {
    const { createMailTransport } = await import('./mail-transport.js');
    createMailTransport({
      NODE_ENV: 'development',
      SMTP_HOST: 'localhost',
      SMTP_PORT: 1025,
      SMTP_SECURE: false,
      SMTP_FROM: 'dev@photoo.test',
    });

    const call = createTransport.mock.calls.at(-1)?.[0];
    expect(call?.requireTLS).toBeUndefined();
  });

  it('does not force TLS in production when SMTP_SECURE is already true', async () => {
    const { createMailTransport } = await import('./mail-transport.js');
    createMailTransport({
      NODE_ENV: 'production',
      SMTP_HOST: 'smtp-relay.brevo.com',
      SMTP_PORT: 465,
      SMTP_SECURE: true,
      SMTP_FROM: 'no-reply@photoo.lu',
    });

    const call = createTransport.mock.calls.at(-1)?.[0];
    expect(call?.requireTLS).toBeUndefined();
  });

  it('requires STARTTLS with TLS 1.2 in production when SMTP_SECURE is false (S1, issue #68)', async () => {
    const { createMailTransport } = await import('./mail-transport.js');
    createMailTransport({
      NODE_ENV: 'production',
      SMTP_HOST: 'smtp-relay.brevo.com',
      SMTP_PORT: 587,
      SMTP_SECURE: false,
      SMTP_FROM: 'no-reply@photoo.lu',
    });

    const call = createTransport.mock.calls.at(-1)?.[0];
    expect(call?.requireTLS).toBe(true);
    expect(call?.tls?.minVersion).toBe('TLSv1.2');
  });

  it('skips TLS enforcement in production when SMTP_INSECURE_INTERNAL_RELAY is set', async () => {
    const { createMailTransport } = await import('./mail-transport.js');
    createMailTransport({
      NODE_ENV: 'production',
      SMTP_HOST: 'mailpit',
      SMTP_PORT: 1025,
      SMTP_SECURE: false,
      SMTP_FROM: 'no-reply@photoo.lu',
      SMTP_INSECURE_INTERNAL_RELAY: true,
    });

    const call = createTransport.mock.calls.at(-1)?.[0];
    expect(call?.requireTLS).toBeUndefined();
  });
});
