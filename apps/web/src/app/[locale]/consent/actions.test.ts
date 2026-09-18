import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  CONSENT_COOKIE_NAME,
  decodeConsentCookieValue,
  isAnalyticsCookieName,
} from '@/lib/consent';

const apiGetMock = vi.fn();
const apiPostMock = vi.fn();
const getSessionMock = vi.fn();
const serverApiMock = vi.fn();
const cookiesMock = vi.fn();

vi.mock('@/lib/api', () => ({ api: { GET: apiGetMock, POST: apiPostMock } }));
vi.mock('@/lib/session', () => ({ getSession: getSessionMock, serverApi: serverApiMock }));
vi.mock('next/headers', () => ({ cookies: cookiesMock }));

interface FakeCookieStore {
  set: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  getAll: ReturnType<typeof vi.fn>;
}

function makeCookieStore(existing: { name: string; value: string }[] = []): FakeCookieStore {
  return {
    set: vi.fn(),
    delete: vi.fn(),
    getAll: vi.fn(() => existing),
  };
}

async function redirectDigest(promise: Promise<unknown>): Promise<string | undefined> {
  const error: unknown = await promise.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(Error);
  return (error as { digest?: string }).digest;
}

function formData(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    data.set(key, value);
  }
  return data;
}

async function loadActions() {
  return import('./actions');
}

describe('consent settings server actions', () => {
  afterEach(() => {
    vi.resetModules();
    apiGetMock.mockReset();
    apiPostMock.mockReset();
    getSessionMock.mockReset();
    serverApiMock.mockReset();
    cookiesMock.mockReset();
  });

  it('acceptAllAction sets the cookie and records both categories anonymously, then redirects', async () => {
    getSessionMock.mockResolvedValue(null);
    apiGetMock.mockResolvedValue({ data: { policyVersion: '1' } });
    apiPostMock.mockResolvedValue({ data: {}, error: undefined });
    const cookieStore = makeCookieStore();
    cookiesMock.mockResolvedValue(cookieStore);
    const { acceptAllAction } = await loadActions();

    const digest = await redirectDigest(acceptAllAction(formData({ locale: 'en' })));

    expect(digest).toContain('/en/consent');
    expect(cookieStore.set).toHaveBeenCalledTimes(1);
    const [name, value] = cookieStore.set.mock.calls[0] as [string, string];
    expect(name).toBe(CONSENT_COOKIE_NAME);
    expect(decodeConsentCookieValue(value)).toMatchObject({
      policyVersion: '1',
      categories: { analytics: true, adsMarketing: true },
    });
    expect(apiPostMock).toHaveBeenCalledTimes(3);
    const postCalls = apiPostMock.mock.calls as [
      string,
      { body: { anonymousId: string; purpose: string; granted: boolean } },
    ][];
    const grantedPurposes = postCalls.map(([, options]) => ({
      purpose: options.body.purpose,
      granted: options.body.granted,
    }));
    expect(grantedPurposes).toEqual(
      expect.arrayContaining([
        { purpose: 'analytics', granted: true },
        { purpose: 'ads', granted: true },
        { purpose: 'marketing', granted: true },
      ]),
    );

    const anonymousIds = new Set(postCalls.map(([, options]) => options.body.anonymousId));
    expect(anonymousIds.size).toBe(1);
  });

  it('rejectAllAction records both categories against the signed-in user and clears analytics cookies', async () => {
    getSessionMock.mockResolvedValue({ id: 'user-1' });
    apiGetMock.mockResolvedValue({ data: { policyVersion: '1' } });
    const putMock = vi.fn().mockResolvedValue({ data: {}, error: undefined });
    serverApiMock.mockResolvedValue({ PUT: putMock });
    const cookieStore = makeCookieStore([
      { name: '_ga', value: 'GA1.2.1.1' },
      { name: '_ga_ABCDE', value: 'x' },
      { name: 'photoo_session', value: 'keep-me' },
    ]);
    cookiesMock.mockResolvedValue(cookieStore);
    const { rejectAllAction } = await loadActions();

    const digest = await redirectDigest(rejectAllAction(formData({ locale: 'en' })));

    expect(digest).toContain('/en/consent');
    expect(putMock).toHaveBeenCalledWith('/v1/me/consents', {
      body: {
        consents: [
          { purpose: 'analytics', granted: false },
          { purpose: 'ads', granted: false },
          { purpose: 'marketing', granted: false },
        ],
      },
    });
    expect(apiPostMock).not.toHaveBeenCalled();

    const deleteCalls = cookieStore.delete.mock.calls as [string][];
    const deletedNames = deleteCalls.map(([name]) => name);
    expect(deletedNames.every((name) => isAnalyticsCookieName(name))).toBe(true);
    expect(deletedNames).toEqual(expect.arrayContaining(['_ga', '_ga_ABCDE']));
    expect(deletedNames).not.toContain('photoo_session');
  });

  it('savePreferencesAction reads only the checked categories from the submitted form', async () => {
    getSessionMock.mockResolvedValue(null);
    apiGetMock.mockResolvedValue({ data: { policyVersion: '1' } });
    apiPostMock.mockResolvedValue({ data: {}, error: undefined });
    const cookieStore = makeCookieStore();
    cookiesMock.mockResolvedValue(cookieStore);
    const { savePreferencesAction } = await loadActions();

    await redirectDigest(savePreferencesAction(formData({ locale: 'en', analytics: 'on' })));

    const [, value] = cookieStore.set.mock.calls[0] as [string, string];
    expect(decodeConsentCookieValue(value)).toMatchObject({
      categories: { analytics: true, adsMarketing: false },
    });
  });

  it('still applies the cookie and redirects when the API write fails', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    getSessionMock.mockResolvedValue(null);
    apiGetMock.mockResolvedValue({ data: { policyVersion: '1' } });
    apiPostMock.mockResolvedValue({ data: undefined, error: { code: 'INTERNAL' } });
    const cookieStore = makeCookieStore();
    cookiesMock.mockResolvedValue(cookieStore);
    const { rejectAllAction } = await loadActions();

    const digest = await redirectDigest(rejectAllAction(formData({ locale: 'en' })));

    expect(digest).toContain('/en/consent');
    expect(cookieStore.set).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy).toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });

  it('falls back to en when the submitted locale is invalid', async () => {
    getSessionMock.mockResolvedValue(null);
    apiGetMock.mockResolvedValue({ data: { policyVersion: '1' } });
    apiPostMock.mockResolvedValue({ data: {}, error: undefined });
    cookiesMock.mockResolvedValue(makeCookieStore());
    const { acceptAllAction } = await loadActions();

    const digest = await redirectDigest(acceptAllAction(formData({ locale: 'not-a-locale' })));

    expect(digest).toContain('/en/consent');
  });
});
