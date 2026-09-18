import { cookies } from 'next/headers';

import { createApiClient, type components } from '@photoo/api-client';

import { env } from './env';

export type SessionUser = components['schemas']['User'];

const sessionClient = createApiClient({ baseUrl: env.NEXT_PUBLIC_API_URL });

const SESSION_COOKIE = 'photoo_session';

// Server-side `fetch` never sees the incoming request's cookies on its own
// (unlike the browser, which attaches them via `credentials: 'include'`), so
// any server component calling an authenticated endpoint needs this to
// forward the session cookie by hand.
async function sessionCookieHeader(): Promise<Record<string, string> | undefined> {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.getAll().find((cookie) => cookie.name === SESSION_COOKIE);
  return sessionCookie ? { cookie: `${SESSION_COOKIE}=${sessionCookie.value}` } : undefined;
}

export async function getSession(): Promise<SessionUser | null> {
  const headers = await sessionCookieHeader();
  if (!headers) {
    return null;
  }

  const { data, response } = await sessionClient.GET('/v1/auth/session', {
    headers,
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

function noRedirectFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return fetch(input, { ...init, redirect: 'error' });
}

// A ready-to-use API client for server components that already forwards the
// session cookie, so callers never build headers by hand; `redirect: 'error'`
// turns a 3xx from the API into a thrown error instead of it being followed
// silently.
export async function serverApi() {
  const headers = (await sessionCookieHeader()) ?? {};
  return createApiClient({
    baseUrl: env.NEXT_PUBLIC_API_URL,
    headers,
    fetch: noRedirectFetch,
  });
}
