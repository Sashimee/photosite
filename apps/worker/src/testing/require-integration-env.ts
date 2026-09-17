// In CI, a missing env var must fail the suite loudly rather than silently
// skip it (a skipped integration suite is invisible in the job log).
export function requireIntegrationEnv<const Keys extends readonly string[]>(
  keys: Keys,
): Record<Keys[number], string> | undefined {
  const values: Record<string, string> = {};
  const missing: string[] = [];

  for (const key of keys) {
    const value = process.env[key];
    if (value) {
      values[key] = value;
    } else {
      missing.push(key);
    }
  }

  if (missing.length > 0) {
    if (process.env.CI === 'true') {
      throw new Error(
        `integration suite requires ${missing.join(', ')} to be set in CI; refusing to skip`,
      );
    }
    return undefined;
  }

  return values;
}
