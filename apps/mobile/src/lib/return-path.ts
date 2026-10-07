import type { Href } from 'expo-router';

const AUTH_ROUTES = new Set([
  'sign-in',
  'sign-up',
  'verify-email',
  'forgot-password',
  'reset-password',
  'two-factor',
]);

function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x1f || codePoint === 0x7f) {
      return true;
    }
  }
  return false;
}

// A return path is only ever an in-app route: a single leading slash, no
// scheme or authority, no backslash, and never an auth screen (that would
// bounce a signed-in user straight back into the redirect that sent them).
export function sanitizeReturnPath(raw: string | string[] | undefined | null): string | null {
  if (typeof raw !== 'string' || !raw.startsWith('/')) {
    return null;
  }
  if (raw.startsWith('//') || raw.includes('\\') || hasControlCharacters(raw)) {
    return null;
  }
  const firstSegment = raw.slice(1).split(/[/?#]/, 1)[0] ?? '';
  if (AUTH_ROUTES.has(firstSegment)) {
    return null;
  }
  return raw;
}

export function signInHref(returnPath: string | null): Href {
  const safe = sanitizeReturnPath(returnPath);
  return safe && safe !== '/' ? { pathname: '/sign-in', params: { next: safe } } : '/sign-in';
}
