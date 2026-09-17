import { createApiClient } from '@photoo/api-client';

import { env } from './env';

export const api = createApiClient({
  baseUrl: env.NEXT_PUBLIC_API_URL,
  credentials: 'include',
});
