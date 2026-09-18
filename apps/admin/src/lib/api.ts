import { createApiClient } from '@photoo/api-client';

import { env } from './env';
import { buildSignInRedirect } from './sign-in-path';

export const api = createApiClient({
  baseUrl: env.NEXT_PUBLIC_API_URL,
  credentials: 'include',
});

type Navigate = (path: string) => void;

let navigate: Navigate = (path) => {
  window.location.assign(path);
};

// Lets tests observe the redirect without a real navigation; production
// code never needs to call this.
export function setNavigateForTesting(fn: Navigate): void {
  navigate = fn;
}

interface ApiErrorBody {
  code?: string;
}

async function errorCode(response: Response): Promise<string | undefined> {
  try {
    const body = (await response.clone().json()) as ApiErrorBody;
    return body.code;
  } catch {
    return undefined;
  }
}

// Auth endpoints report their own 401s inline (wrong password, wrong TOTP
// code, ...) via the form that called them, so a global redirect here would
// fight that form and, for a stale bookmark to /sign-in itself, loop.
function isAuthEndpoint(url: string): boolean {
  return new URL(url).pathname.startsWith('/v1/auth/');
}

function currentPath(): string {
  return `${window.location.pathname}${window.location.search}`;
}

api.use({
  async onResponse({ request, response }) {
    if (response.status === 401 && !isAuthEndpoint(request.url)) {
      navigate(buildSignInRedirect(currentPath()));
      return response;
    }
    if (response.status === 403 && (await errorCode(response)) === 'TWO_FACTOR_REQUIRED') {
      navigate(buildSignInRedirect(currentPath(), 'reverify'));
    }
    return response;
  },
});
