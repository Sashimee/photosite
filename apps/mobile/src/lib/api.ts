import { createApiClient } from '@photoo/api-client';

import { env } from './env';
import { getSessionToken } from './session';

export const api = createApiClient({
  baseUrl: env.EXPO_PUBLIC_API_URL,
  credentials: 'omit',
});

type UnauthorizedListener = () => void;

let unauthorizedListener: UnauthorizedListener | null = null;

// Registered by the auth context, the single place a session actually gets
// cleared. Only fires for requests that carried a bearer token: an
// unauthenticated 401 (e.g. a wrong sign-in password) isn't a revoked session.
export function setUnauthorizedListener(listener: UnauthorizedListener | null): void {
  unauthorizedListener = listener;
}

const CODES_THAT_KEEP_THE_SESSION = new Set(['INVALID_CODE']);

async function isSessionRejection(response: Response): Promise<boolean> {
  try {
    const body = (await response.clone().json()) as { code?: unknown };
    return typeof body.code !== 'string' || !CODES_THAT_KEEP_THE_SESSION.has(body.code);
  } catch {
    return true;
  }
}

api.use({
  async onRequest({ request }) {
    const token = await getSessionToken();
    if (token) {
      request.headers.set('Authorization', `Bearer ${token}`);
    }
    return request;
  },
  async onResponse({ request, response }) {
    if (
      response.status === 401 &&
      request.headers.has('Authorization') &&
      (await isSessionRejection(response))
    ) {
      unauthorizedListener?.();
    }
  },
});
