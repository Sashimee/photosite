import { NextResponse, type NextRequest } from 'next/server';

import { buildCspHeader, originOf, websocketOrigin } from './lib/csp';
import { env } from './lib/env';
import { buildLocaleRedirectPath } from './lib/locale-routing';

const connectOrigins = [
  originOf(env.NEXT_PUBLIC_API_URL),
  websocketOrigin(originOf(env.NEXT_PUBLIC_API_URL)),
  originOf(env.NEXT_PUBLIC_SENTRY_DSN),
  originOf(env.NEXT_PUBLIC_STORAGE_ORIGIN),
].filter((origin): origin is string => origin !== null);

// The chat attachment preview (AttachmentChip) renders an <img> pointed
// straight at a presigned download URL rather than a blob copy, so the
// presign origin needs img-src too, not just connect-src (#322).
const imgOrigins = [
  originOf(env.NEXT_PUBLIC_MEDIA_BASE_URL),
  originOf(env.NEXT_PUBLIC_STORAGE_ORIGIN),
].filter((origin): origin is string => origin !== null);

// apps/api/src/common/constants.ts's REVISION_HEADER sets the same name.
const REVISION_HEADER = 'x-photoo-revision';
const revision = process.env.PHOTOO_REVISION ?? 'unknown';

export function proxy(request: NextRequest): NextResponse {
  const { pathname, search } = request.nextUrl;
  const isDev = process.env.NODE_ENV === 'development';
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const cspHeader = buildCspHeader(nonce, isDev, connectOrigins, imgOrigins);

  const redirectPath = buildLocaleRedirectPath(
    pathname,
    search,
    request.headers.get('accept-language'),
  );

  if (redirectPath) {
    const response = NextResponse.redirect(new URL(redirectPath, request.url));
    response.headers.set('Content-Security-Policy', cspHeader);
    response.headers.set(REVISION_HEADER, revision);
    return response;
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', cspHeader);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', cspHeader);
  response.headers.set(REVISION_HEADER, revision);
  return response;
}

export const config = {
  matcher: [
    {
      source: '/((?!_next/static|_next/image|api|.*\\..*).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
