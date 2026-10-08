const EMAIL_PATTERN = /[^\s@:]+@[^\s@]+\.[^\s@]+/g;

// Better Auth interpolates emails into message text (e.g. "Sign-up attempt for
// existing email: ..."), where pino redaction cannot reach them.
export function scrubAuthLogMessage(message: string): string {
  return message.replace(EMAIL_PATTERN, '[redacted-email]');
}
