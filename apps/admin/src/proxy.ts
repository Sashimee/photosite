import { NextResponse, type NextRequest } from 'next/server';

import { buildCspHeader, originOf } from './lib/csp';
import { env } from './lib/env';

const connectOrigins = [
  originOf(env.NEXT_PUBLIC_API_URL),
  originOf(env.NEXT_PUBLIC_STORAGE_ORIGIN),
].filter((origin): origin is string => origin !== null);

export function proxy(request: NextRequest): NextResponse {
  const isDev = process.env.NODE_ENV === 'development';
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const cspHeader = buildCspHeader(nonce, isDev, connectOrigins);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  // Server Component layouts don't receive the current path (only pages do,
  // via searchParams), so this is how app/(admin)/layout.tsx builds a
  // sign-in redirect that returns the visitor to where they were.
  requestHeaders.set('x-pathname', `${request.nextUrl.pathname}${request.nextUrl.search}`);
  requestHeaders.set('Content-Security-Policy', cspHeader);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', cspHeader);
  return response;
}

export const config = {
  matcher: [
    {
      source: '/((?!_next/static|_next/image|.*\\..*).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
