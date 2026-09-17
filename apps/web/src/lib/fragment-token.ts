// Email links point at `#token=...` (see docs/steps/1B.2-web-auth-screens.md):
// the fragment never reaches the server, so the token is read here and POSTed
// by the client instead.
export function parseFragmentToken(hash: string): string | null {
  const value = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!value) {
    return null;
  }
  const params = new URLSearchParams(value);
  const token = params.get('token');
  return token && token.length > 0 ? token : null;
}
