import type { MailMessage } from '@photoo/email';
import nodemailer, { type Transporter } from 'nodemailer';

export type { MailMessage } from '@photoo/email';

export interface MailTransportConfig {
  NODE_ENV: 'development' | 'production' | 'test';
  SMTP_HOST: string;
  SMTP_PORT: number;
  SMTP_SECURE: boolean;
  SMTP_USER?: string | undefined;
  SMTP_PASSWORD?: string | undefined;
  SMTP_FROM: string;
  SMTP_INSECURE_INTERNAL_RELAY?: boolean | undefined;
}

export interface MailTransport {
  sendMail(message: MailMessage): Promise<void>;
}

// S1 (issue #68): production must use TLS, either implicit (SMTP_SECURE)
// or STARTTLS enforced via requireTLS, with TLS 1.2 as the floor.
// SMTP_INSECURE_INTERNAL_RELAY is a loud, explicit opt-out for a relay only
// reachable on a private network (the preview's Mailpit container); every
// boot with it set logs a warning (see queue-workers.service.ts).
interface TlsOptions {
  requireTLS?: boolean;
  tls?: { minVersion: 'TLSv1.2' };
}

function tlsOptions(config: MailTransportConfig): TlsOptions {
  const isProduction = config.NODE_ENV === 'production';
  if (!isProduction || config.SMTP_SECURE || config.SMTP_INSECURE_INTERNAL_RELAY) {
    return {};
  }
  return { requireTLS: true, tls: { minVersion: 'TLSv1.2' } };
}

export function createMailTransport(config: MailTransportConfig): MailTransport {
  const transport: Transporter = nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_SECURE,
    auth:
      config.SMTP_USER && config.SMTP_PASSWORD
        ? { user: config.SMTP_USER, pass: config.SMTP_PASSWORD }
        : undefined,
    ...tlsOptions(config),
  });

  return {
    async sendMail(message: MailMessage): Promise<void> {
      await transport.sendMail({ from: config.SMTP_FROM, ...message });
    },
  };
}
