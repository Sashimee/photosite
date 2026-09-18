const UNSAFE_LEADING = /^\/[\\/]/;

function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x1f || codePoint === 0x7f) {
      return true;
    }
  }
  return false;
}

// Only a same-origin, single-leading-slash relative path is a safe `next`
// redirect target: reject absolute URLs and scheme values outright (they
// never start with "/"), protocol-relative paths ("//evil.com"), the
// backslash trick browsers treat as an extra slash ("/\evil.com"), and
// anything percent-encoded into either of those once decoded.
export function sanitizeNextPath(rawValue: string | null | undefined, fallback: string): string {
  if (!rawValue) {
    return fallback;
  }

  let decoded: string;
  try {
    decoded = decodeURIComponent(rawValue);
  } catch {
    return fallback;
  }

  if (!decoded.startsWith('/')) {
    return fallback;
  }
  if (UNSAFE_LEADING.test(decoded)) {
    return fallback;
  }
  if (decoded.includes('\\')) {
    return fallback;
  }
  if (hasControlCharacters(decoded)) {
    return fallback;
  }

  return decoded;
}
