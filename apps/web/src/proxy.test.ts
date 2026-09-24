import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Guards the actual regression (#322): every value proxy.ts feeds into
// buildCspHeader comes from ./lib/env at module load, so a unit test that
// only calls buildCspHeader directly (csp.test.ts) can pass while the real
// header - built from real env vars - is still missing an origin. This
// exercises that wiring end to end, the way a real request hits it.
async function loadProxy(vars: Record<string, string>) {
  vi.resetModules();
  for (const [key, value] of Object.entries(vars)) vi.stubEnv(key, value);
  return import('./proxy');
}

describe('proxy CSP wiring', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('allows the presigned-upload origin in connect-src and img-src when NEXT_PUBLIC_STORAGE_ORIGIN is set', async () => {
    const { proxy } = await loadProxy({
      NEXT_PUBLIC_API_URL: 'http://127.0.0.1:4000',
      NEXT_PUBLIC_SITE_URL: 'http://127.0.0.1:3000',
      NEXT_PUBLIC_STORAGE_ORIGIN: 'http://127.0.0.1:9000',
    });

    const response = proxy(new NextRequest('http://127.0.0.1:3000/en'));
    const csp = response.headers.get('Content-Security-Policy');

    expect(csp).toContain(
      "connect-src 'self' http://127.0.0.1:4000 ws://127.0.0.1:4000 http://127.0.0.1:9000",
    );
    expect(csp).toContain("img-src 'self' blob: data: http://127.0.0.1:9000");
  });

  it('does not add a storage origin to the CSP when NEXT_PUBLIC_STORAGE_ORIGIN is unset', async () => {
    const { proxy } = await loadProxy({
      NEXT_PUBLIC_API_URL: 'http://127.0.0.1:4000',
      NEXT_PUBLIC_SITE_URL: 'http://127.0.0.1:3000',
    });

    const response = proxy(new NextRequest('http://127.0.0.1:3000/en'));
    const csp = response.headers.get('Content-Security-Policy');

    expect(csp).toContain("connect-src 'self' http://127.0.0.1:4000 ws://127.0.0.1:4000;");
    expect(csp).toContain("img-src 'self' blob: data:;");
  });

  it('does not widen the CSP to a wildcard when the storage origin differs from the API origin', async () => {
    const { proxy } = await loadProxy({
      NEXT_PUBLIC_API_URL: 'https://api.photoo.lu',
      NEXT_PUBLIC_SITE_URL: 'https://photoo.lu',
      NEXT_PUBLIC_STORAGE_ORIGIN: 'https://s3.photoo.lu',
    });

    const response = proxy(new NextRequest('https://photoo.lu/en'));
    const csp = response.headers.get('Content-Security-Policy');

    expect(csp).not.toContain('connect-src *');
    expect(csp).not.toMatch(/connect-src[^;]*\*/);
    expect(csp).toContain(
      "connect-src 'self' https://api.photoo.lu wss://api.photoo.lu https://s3.photoo.lu;",
    );
  });
});
