import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface FakeCookieStore {
  getAll: () => { name: string; value: string }[];
}

const cookiesMock = vi.fn<() => Promise<FakeCookieStore>>();

vi.mock('next/headers', () => ({
  cookies: () => cookiesMock(),
}));

const sampleUser = {
  id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  email: 'client@example.com',
  emailVerifiedAt: null,
  locale: 'en',
  country: 'LU',
  roles: ['client'],
  status: 'active',
  twoFactorEnabled: false,
  lastLoginAt: null,
};

describe('getSession', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('forwards only the session cookie and returns the session user', async () => {
    cookiesMock.mockResolvedValue({
      getAll: () => [
        { name: 'photoo_session', value: 'abc' },
        { name: 'other', value: 'def' },
      ],
    });
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ user: sampleUser }), { status: 200 }),
    );

    const { getSession } = await import('./session');
    const user = await getSession();

    expect(user).toEqual(sampleUser);
    const [request] = fetchMock.mock.calls[0] as [Request];
    expect(request.headers.get('cookie')).toBe('photoo_session=abc');
  });

  it('returns null without calling the API when there is no session cookie', async () => {
    cookiesMock.mockResolvedValue({ getAll: () => [{ name: 'other', value: 'def' }] });

    const { getSession } = await import('./session');
    const user = await getSession();

    expect(user).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns null when the API rejects the session', async () => {
    cookiesMock.mockResolvedValue({
      getAll: () => [{ name: 'photoo_session', value: 'expired' }],
    });
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ code: 'UNAUTHORIZED' }), { status: 401 }),
    );

    const { getSession } = await import('./session');
    const user = await getSession();

    expect(user).toBeNull();
  });

  it('throws instead of treating an API failure as signed out', async () => {
    cookiesMock.mockResolvedValue({
      getAll: () => [{ name: 'photoo_session', value: 'abc' }],
    });
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ code: 'INTERNAL' }), { status: 500 }),
    );

    const { getSession } = await import('./session');

    await expect(getSession()).rejects.toThrow('HTTP 500');
  });
});

describe('serverApi', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('forwards the session cookie on every call', async () => {
    cookiesMock.mockResolvedValue({
      getAll: () => [
        { name: 'photoo_session', value: 'abc' },
        { name: 'other', value: 'def' },
      ],
    });

    const { serverApi } = await import('./session');
    const client = await serverApi();
    await client.GET('/v1/countries');

    const [request] = fetchMock.mock.calls[0] as [Request];
    expect(request.headers.get('cookie')).toBe('photoo_session=abc');
  });

  it('still returns a working client without a session cookie', async () => {
    cookiesMock.mockResolvedValue({ getAll: () => [{ name: 'other', value: 'def' }] });

    const { serverApi } = await import('./session');
    const client = await serverApi();
    await client.GET('/v1/countries');

    const [request] = fetchMock.mock.calls[0] as [Request];
    expect(request.headers.get('cookie')).toBeNull();
  });

  it('rejects a redirect from the API instead of following it', async () => {
    cookiesMock.mockResolvedValue({
      getAll: () => [{ name: 'photoo_session', value: 'abc' }],
    });
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    const { serverApi } = await import('./session');
    const client = await serverApi();

    await expect(client.GET('/v1/countries')).rejects.toThrow();
    const [, init] = fetchMock.mock.calls[0] as [RequestInfo, RequestInit];
    expect(init.redirect).toBe('error');
  });
});
