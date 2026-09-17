import { cookies } from 'next/headers';

import { createApiClient, type components } from '@photoo/api-client';

import { env } from './env';

export type SessionUser = components['schemas']['User'];

const sessionClient = createApiClient({ baseUrl: env.NEXT_PUBLIC_API_URL });

const SESSION_COOKIE = 'photoo_session';

export async function getSession(): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.getAll().find((cookie) => cookie.name === SESSION_COOKIE);
  if (!sessionCookie) {
    return null;
  }

  const { data, response } = await sessionClient.GET('/v1/auth/session', {
    headers: { cookie: `${SESSION_COOKIE}=${sessionCookie.value}` },
    cache: 'no-store',
  });

  if (response.status === 401) {
    return null;
  }
  if (!data) {
    throw new Error(
      `Session lookup failed with HTTP ${String(response.status)}; check the API at NEXT_PUBLIC_API_URL`,
    );
  }
  return data.user;
}
