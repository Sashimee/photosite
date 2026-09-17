import { createApiClient } from '@photoo/api-client';

import { env } from './env';
import { getSessionToken } from './session';

export const api = createApiClient({ baseUrl: env.EXPO_PUBLIC_API_URL });

api.use({
  async onRequest({ request }) {
    const token = await getSessionToken();
    if (token) {
      request.headers.set('Authorization', `Bearer ${token}`);
    }
    return request;
  },
});
