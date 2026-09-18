import { afterEach, describe, expect, it, vi } from 'vitest';

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

// openapi-fetch resolves `globalThis.fetch` once when `createApiClient` runs,
// so each test stubs fetch and then re-imports the module (after
// `vi.resetModules()`) to get a client bound to that test's stub.
async function loadApi() {
  vi.resetModules();
  return import('./api');
}

describe('api response interceptor', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    window.history.pushState({}, '', '/');
  });

  it('redirects to sign-in on a 401 from a non-auth endpoint, preserving the path', async () => {
    window.history.pushState({}, '', '/reports?page=2');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ code: 'UNAUTHORIZED' }, 401)));
    const { api, setNavigateForTesting } = await loadApi();
    const navigate = vi.fn();
    setNavigateForTesting(navigate);

    await api.GET('/v1/admin/users', { params: { query: {} } });

    expect(navigate).toHaveBeenCalledWith('/sign-in?next=%2Freports%3Fpage%3D2');
  });

  it('does not redirect on a 401 from an auth endpoint', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ code: 'INVALID_EMAIL_OR_PASSWORD' }, 401)),
    );
    const { api, setNavigateForTesting } = await loadApi();
    const navigate = vi.fn();
    setNavigateForTesting(navigate);

    await api.POST('/v1/auth/sign-in', { body: { email: 'a@example.com', password: 'x' } });

    expect(navigate).not.toHaveBeenCalled();
  });

  it('redirects to a reverify prompt on a 403 TWO_FACTOR_REQUIRED', async () => {
    window.history.pushState({}, '', '/reports?page=2');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ code: 'TWO_FACTOR_REQUIRED' }, 403)),
    );
    const { api, setNavigateForTesting } = await loadApi();
    const navigate = vi.fn();
    setNavigateForTesting(navigate);

    await api.GET('/v1/admin/users', { params: { query: {} } });

    expect(navigate).toHaveBeenCalledWith('/sign-in?next=%2Freports%3Fpage%3D2&reverify=1');
  });

  it('does not redirect on an ordinary 403', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ code: 'FORBIDDEN' }, 403)));
    const { api, setNavigateForTesting } = await loadApi();
    const navigate = vi.fn();
    setNavigateForTesting(navigate);

    await api.GET('/v1/admin/users', { params: { query: {} } });

    expect(navigate).not.toHaveBeenCalled();
  });

  it('leaves a successful response alone', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ items: [] }, 200)));
    const { api, setNavigateForTesting } = await loadApi();
    const navigate = vi.fn();
    setNavigateForTesting(navigate);

    await api.GET('/v1/admin/users', { params: { query: {} } });

    expect(navigate).not.toHaveBeenCalled();
  });
});
