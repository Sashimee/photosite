import { createApiClient } from '@photoo/api-client';

import { env } from './env';
import { getSessionToken } from './session';

export const api = createApiClient({ baseUrl: env.EXPO_PUBLIC_API_URL });

type UnauthorizedListener = () => void;

let unauthorizedListener: UnauthorizedListener | null = null;

// Registered by the auth context, the single place a session actually gets
// cleared. Only fires for requests that carried a bearer token: an
// unauthenticated 401 (e.g. a wrong sign-in password) isn't a revoked session.
export function setUnauthorizedListener(listener: UnauthorizedListener | null): void {
  unauthorizedListener = listener;
}

api.use({
  async onRequest({ request }) {
    const token = await getSessionToken();
    if (token) {
      request.headers.set('Authorization', `Bearer ${token}`);
    }
    return request;
  },
  onResponse({ request, response }) {
    if (response.status === 401 && request.headers.has('Authorization')) {
      unauthorizedListener?.();
    }
  },
});
