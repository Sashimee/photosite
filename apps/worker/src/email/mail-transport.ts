import nodemailer, { type Transporter } from 'nodemailer';

export interface MailTransportConfig {
  SMTP_HOST: string;
  SMTP_PORT: number;
  SMTP_SECURE: boolean;
  SMTP_USER?: string | undefined;
  SMTP_PASSWORD?: string | undefined;
  SMTP_FROM: string;
}

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  headers?: Record<string, string>;
}

export interface MailTransport {
  sendMail(message: MailMessage): Promise<void>;
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
  });

  return {
    async sendMail(message: MailMessage): Promise<void> {
      await transport.sendMail({ from: config.SMTP_FROM, ...message });
    },
  };
}
