export const SENSITIVE_KEY_NAMES = [
  'password',
  'token',
  'secret',
  'authorization',
  'cookie',
] as const;

// Substring match, not exact: catches header/field name variants
// (newPassword, set-cookie, apiToken, clientSecret) without enumerating each
// one. Shared by the pino redact config and Sentry's beforeSend.
export function isSensitiveKeyName(key: string): boolean {
  const normalized = key.toLowerCase();
  return SENSITIVE_KEY_NAMES.some((name) => normalized.includes(name));
}

export function buildSensitiveKeyRedactPaths(): string[] {
  return SENSITIVE_KEY_NAMES.flatMap((name) => [name, `*.${name}`]);
}
