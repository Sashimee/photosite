import { sanitizeNextPath } from './next-param';

export const SIGN_IN_PATH = '/sign-in';

export type SignInRedirectReason = 'reverify' | 'enroll';

export function buildSignInRedirect(
  pathname: string | null | undefined,
  reason?: SignInRedirectReason,
): string {
  const params = new URLSearchParams();
  const next = sanitizeNextPath(pathname, '');
  if (next) {
    params.set('next', next);
  }
  if (reason) {
    params.set(reason, '1');
  }

  const query = params.toString();
  return query ? `${SIGN_IN_PATH}?${query}` : SIGN_IN_PATH;
}
