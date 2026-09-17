import { afterEach, describe, expect, it, vi } from 'vitest';

import { translate } from '@/testing/mock-translations';

const getSessionMock = vi.fn();

vi.mock('@/lib/session', () => ({ getSession: getSessionMock }));
vi.mock('next-intl/server', () => ({
  getTranslations:
    ({ namespace }: { namespace: string }) =>
    (key: string, values?: Record<string, unknown>) =>
      translate(namespace, key, values),
}));

async function loadPage() {
  const mod = await import('./page');
  return mod.default;
}

async function redirectDigest(promise: Promise<unknown>): Promise<string | undefined> {
  const error: unknown = await promise.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(Error);
  return (error as { digest?: string }).digest;
}

describe('NewRequestPage', () => {
  afterEach(() => {
    vi.resetModules();
    getSessionMock.mockReset();
  });

  it('redirects to sign-in with the sanitised next path when signed out', async () => {
    getSessionMock.mockResolvedValue(null);
    const NewRequestPage = await loadPage();

    const digest = await redirectDigest(
      NewRequestPage({
        params: Promise.resolve({ locale: 'en' }),
        searchParams: Promise.resolve({ photographer: 'sofia-martins' }),
      }),
    );

    expect(digest).toContain(
      '/en/sign-in?next=%2Fen%2Frequests%2Fnew%3Fphotographer%3Dsofia-martins',
    );
  });

  it('drops an invalid photographer slug from the next path', async () => {
    getSessionMock.mockResolvedValue(null);
    const NewRequestPage = await loadPage();

    const digest = await redirectDigest(
      NewRequestPage({
        params: Promise.resolve({ locale: 'en' }),
        searchParams: Promise.resolve({ photographer: '../evil' }),
      }),
    );

    expect(digest).toContain('/en/sign-in?next=%2Fen%2Frequests%2Fnew');
    expect(digest).not.toContain('evil');
  });

  it('redirects to sign-in with no photographer param when none is given', async () => {
    getSessionMock.mockResolvedValue(null);
    const NewRequestPage = await loadPage();

    const digest = await redirectDigest(
      NewRequestPage({
        params: Promise.resolve({ locale: 'en' }),
        searchParams: Promise.resolve({}),
      }),
    );

    expect(digest).toContain(encodeURIComponent('/en/requests/new'));
    expect(digest).not.toContain('photographer');
  });

  it('shows the placeholder with a back link to the photographer when signed in', async () => {
    getSessionMock.mockResolvedValue({ id: 'user-1' });
    const NewRequestPage = await loadPage();

    const element = await NewRequestPage({
      params: Promise.resolve({ locale: 'en' }),
      searchParams: Promise.resolve({ photographer: 'sofia-martins' }),
    });

    const link = (element.props as { children: unknown[] }).children[2] as {
      props: { children: { props: { href: string } } };
    };
    expect(link.props.children.props.href).toBe('/en/photographers/sofia-martins');
  });

  it('falls back to the home link when there is no valid photographer', async () => {
    getSessionMock.mockResolvedValue({ id: 'user-1' });
    const NewRequestPage = await loadPage();

    const element = await NewRequestPage({
      params: Promise.resolve({ locale: 'en' }),
      searchParams: Promise.resolve({}),
    });

    const link = (element.props as { children: unknown[] }).children[2] as {
      props: { children: { props: { href: string } } };
    };
    expect(link.props.children.props.href).toBe('/en');
  });
});
