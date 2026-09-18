import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildDecision, CONSENT_COOKIE_NAME, encodeConsentCookieValue } from '@/lib/consent';
import { translate } from '@/testing/mock-translations';

const apiGetMock = vi.fn();
const getSessionMock = vi.fn();
const serverApiMock = vi.fn();
const cookiesMock = vi.fn();

vi.mock('@/lib/api', () => ({ api: { GET: apiGetMock } }));
vi.mock('@/lib/session', () => ({ getSession: getSessionMock, serverApi: serverApiMock }));
vi.mock('next/headers', () => ({ cookies: cookiesMock }));
vi.mock('next-intl/server', () => ({
  getTranslations:
    ({ namespace }: { namespace: string }) =>
    (key: string, values?: Record<string, unknown>) =>
      translate(namespace, key, values),
}));
vi.mock('./actions', () => ({
  acceptAllAction: vi.fn(),
  rejectAllAction: vi.fn(),
  savePreferencesAction: vi.fn(),
}));

interface TreeNode {
  type: unknown;
  props?: Record<string, unknown>;
}

function isTreeNode(value: unknown): value is TreeNode {
  return typeof value === 'object' && value !== null && 'type' in value;
}

function collect(node: unknown, predicate: (node: TreeNode) => boolean, into: TreeNode[] = []) {
  if (Array.isArray(node)) {
    for (const child of node) collect(child, predicate, into);
    return into;
  }
  if (!isTreeNode(node)) {
    return into;
  }
  if (predicate(node)) {
    into.push(node);
  }
  const children = node.props?.children;
  if (children !== undefined) {
    collect(children, predicate, into);
  }
  return into;
}

// `./page` is re-imported after `vi.resetModules()` between tests, which
// gives its `Switch`/`Button` imports a fresh module identity each time; a
// reference imported once at the top of this file would stop matching
// after the first reset, so components are matched by name instead.
function byComponentName(name: string) {
  return (node: TreeNode) => (node.type as { name?: string } | undefined)?.name === name;
}

async function loadPage() {
  const mod = await import('./page');
  return mod.default;
}

function mockCookies(value?: string) {
  cookiesMock.mockResolvedValue({
    get: (name: string) => (name === CONSENT_COOKIE_NAME && value ? { value } : undefined),
    getAll: () => (value ? [{ name: CONSENT_COOKIE_NAME, value }] : []),
  });
}

function mockPolicyVersion(policyVersion: string | null) {
  apiGetMock.mockImplementation((path: string) => {
    if (path === '/v1/policy-version') {
      return Promise.resolve({ data: { policyVersion } });
    }
    throw new Error(`unexpected api.GET(${path})`);
  });
}

describe('ConsentSettingsPage', () => {
  afterEach(() => {
    vi.resetModules();
    apiGetMock.mockReset();
    getSessionMock.mockReset();
    serverApiMock.mockReset();
    cookiesMock.mockReset();
  });

  it('shows undecided categories and wires the three actions for a first-time anonymous visitor', async () => {
    getSessionMock.mockResolvedValue(null);
    mockCookies(undefined);
    mockPolicyVersion('1');
    const ConsentSettingsPage = await loadPage();

    const element = await ConsentSettingsPage({ params: Promise.resolve({ locale: 'en' }) });

    const switches = collect(element, byComponentName('Switch'));
    expect(switches).toHaveLength(3);
    const [necessary, analytics, adsMarketing] = switches;
    expect(necessary?.props?.checked).toBe(true);
    expect(necessary?.props?.disabled).toBe(true);
    expect(necessary?.props?.name).toBeUndefined();
    expect(analytics?.props?.name).toBe('analytics');
    expect(analytics?.props?.defaultChecked).toBe(false);
    expect(adsMarketing?.props?.name).toBe('adsMarketing');
    expect(adsMarketing?.props?.defaultChecked).toBe(false);

    const buttons = collect(element, byComponentName('Button'));
    expect(buttons).toHaveLength(3);
    const actionsModule = (await import('./actions')) as {
      acceptAllAction: unknown;
      rejectAllAction: unknown;
      savePreferencesAction: unknown;
    };
    expect(buttons.map((button) => button.props?.formAction)).toEqual([
      actionsModule.acceptAllAction,
      actionsModule.rejectAllAction,
      actionsModule.savePreferencesAction,
    ]);

    const statusTexts = collect(element, (node) => typeof node.props?.children === 'string').map(
      (node) => node.props?.children,
    );
    expect(statusTexts).toContain(translate('web.consent.settings', 'notDecidedYet'));
  });

  it('pre-fills the stored decision from the cookie for a signed-out visitor', async () => {
    getSessionMock.mockResolvedValue(null);
    const decision = buildDecision({ analytics: true, adsMarketing: false }, '1');
    mockCookies(encodeConsentCookieValue(decision));
    mockPolicyVersion('1');
    const ConsentSettingsPage = await loadPage();

    const element = await ConsentSettingsPage({ params: Promise.resolve({ locale: 'en' }) });

    const switches = collect(element, byComponentName('Switch'));
    const [, analytics, adsMarketing] = switches;
    expect(analytics?.props?.defaultChecked).toBe(true);
    expect(adsMarketing?.props?.defaultChecked).toBe(false);
  });

  it('reads the authoritative state from the API for a signed-in visitor', async () => {
    getSessionMock.mockResolvedValue({ id: 'user-1' });
    const meConsentsGetMock = vi.fn().mockResolvedValue({
      data: {
        consents: [
          {
            purpose: 'analytics',
            granted: true,
            policyVersion: '1',
            recordedAt: '2026-01-01T00:00:00.000Z',
          },
          {
            purpose: 'ads',
            granted: true,
            policyVersion: '1',
            recordedAt: '2026-01-01T00:00:00.000Z',
          },
          {
            purpose: 'marketing',
            granted: false,
            policyVersion: '1',
            recordedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      },
    });
    serverApiMock.mockResolvedValue({ GET: meConsentsGetMock });
    mockCookies(undefined);
    mockPolicyVersion('1');
    const ConsentSettingsPage = await loadPage();

    const element = await ConsentSettingsPage({ params: Promise.resolve({ locale: 'en' }) });

    const switches = collect(element, byComponentName('Switch'));
    const [, analytics, adsMarketing] = switches;
    expect(analytics?.props?.defaultChecked).toBe(true);
    expect(adsMarketing?.props?.defaultChecked).toBe(false);
    expect(meConsentsGetMock).toHaveBeenCalledWith('/v1/me/consents');
  });

  it('shows a policy-updated notice once a newer version has been published', async () => {
    getSessionMock.mockResolvedValue(null);
    const decision = buildDecision({ analytics: true, adsMarketing: true }, '1');
    mockCookies(encodeConsentCookieValue(decision));
    mockPolicyVersion('2');
    const ConsentSettingsPage = await loadPage();

    const element = await ConsentSettingsPage({ params: Promise.resolve({ locale: 'en' }) });

    const texts = collect(element, (node) => typeof node.props?.children === 'string').map(
      (node) => node.props?.children,
    );
    expect(texts).toContain(translate('web.consent.settings', 'policyUpdated'));
  });
});

describe('ConsentSettingsPage generateMetadata', () => {
  afterEach(() => {
    vi.resetModules();
  });

  it('opts out of indexing deliberately', async () => {
    const mod = await import('./page');
    const metadata = await mod.generateMetadata({ params: Promise.resolve({ locale: 'en' }) });
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });
});
