import { afterEach, describe, expect, it, vi } from 'vitest';

import { translate } from '@/testing/mock-translations';

const REQUEST_ID = '3fa85f64-5717-4562-b3fc-2c963f66a111';
const QUOTE_ID = '3fa85f64-5717-4562-b3fc-2c963f66a222';

const getSessionMock = vi.fn();
const apiGetMock = vi.fn();

vi.mock('@/lib/session', () => ({
  getSession: getSessionMock,
  serverApi: vi.fn().mockResolvedValue({ GET: apiGetMock }),
}));
vi.mock('next-intl/server', () => ({
  getTranslations:
    ({ namespace }: { namespace: string }) =>
    (key: string, values?: Record<string, unknown>) =>
      translate(namespace, key, values),
}));

const REQUEST_ITEM = {
  id: REQUEST_ID,
  clientId: 'client-1',
  title: 'Wedding photographer needed',
  category: 'wedding',
  description: 'Full day coverage',
  eventDate: '2026-10-01T12:00:00.000Z',
  dateFlexible: false,
  location: { lat: 49.61, lng: 6.13 },
  address: {
    line1: '10 rue de la Gare',
    line2: 'Floor 2',
    city: 'Luxembourg',
    postalCode: 'L-1611',
    countryCode: 'LU',
  },
  budgetMin: { amountCents: 100000, currency: 'EUR' },
  budgetMax: { amountCents: 200000, currency: 'EUR' },
  usage: 'personal',
  status: 'quoted',
  expiresAt: null,
};

const QUOTE = {
  id: QUOTE_ID,
  requestId: REQUEST_ID,
  photographerId: 'photographer-1',
  clientId: 'client-1',
  productId: null,
  productTierId: null,
  lineItems: [{ label: 'Full day coverage', qty: 1, unitCents: 150000 }],
  subtotal: { amountCents: 150000, currency: 'EUR' },
  platformFee: { amountCents: 7500, currency: 'EUR' },
  total: { amountCents: 157500, currency: 'EUR' },
  validUntil: '2026-12-01T00:00:00.000Z',
  message: null,
  status: 'sent',
};

function mockApi({
  request,
  requestStatus = 200,
  quotes,
  quotesStatus = 200,
}: {
  request?: unknown;
  requestStatus?: number;
  quotes?: unknown[];
  quotesStatus?: number;
}) {
  apiGetMock.mockImplementation((url: string) => {
    if (url === '/v1/requests/{id}') {
      return Promise.resolve({ data: request, response: { status: requestStatus } });
    }
    if (url === '/v1/requests/{requestId}/quotes') {
      return Promise.resolve({
        data: quotes ? { items: quotes, nextCursor: null } : undefined,
        response: { status: quotesStatus },
      });
    }
    throw new Error(`unexpected GET ${url}`);
  });
}

async function loadPage() {
  const mod = await import('./page');
  return mod.default;
}

async function redirectDigest(promise: Promise<unknown>): Promise<string | undefined> {
  const error: unknown = await promise.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(Error);
  return (error as { digest?: string }).digest;
}

describe('RequestDetailPage', () => {
  afterEach(() => {
    vi.resetModules();
    getSessionMock.mockReset();
    apiGetMock.mockReset();
  });

  it('redirects to sign-in with the sanitised next path when signed out', async () => {
    getSessionMock.mockResolvedValue(null);
    const RequestDetailPage = await loadPage();

    const digest = await redirectDigest(
      RequestDetailPage({ params: Promise.resolve({ locale: 'en', id: REQUEST_ID }) }),
    );

    expect(digest).toContain(encodeURIComponent(`/en/requests/${REQUEST_ID}`));
  });

  it('renders notFound when the id is not a valid identifier', async () => {
    getSessionMock.mockResolvedValue({ id: 'user-1' });
    const RequestDetailPage = await loadPage();

    const digest = await redirectDigest(
      RequestDetailPage({ params: Promise.resolve({ locale: 'en', id: 'not-a-uuid' }) }),
    );

    expect(digest).toMatch(/;404$/);
    expect(apiGetMock).not.toHaveBeenCalled();
  });

  it('renders notFound when the request does not exist or is not the caller’s', async () => {
    getSessionMock.mockResolvedValue({ id: 'user-1' });
    mockApi({ requestStatus: 404 });
    const RequestDetailPage = await loadPage();

    const digest = await redirectDigest(
      RequestDetailPage({ params: Promise.resolve({ locale: 'en', id: REQUEST_ID }) }),
    );

    expect(digest).toMatch(/;404$/);
  });

  it('renders notFound on a 403, the same as a 404', async () => {
    getSessionMock.mockResolvedValue({ id: 'user-1' });
    mockApi({ requestStatus: 403 });
    const RequestDetailPage = await loadPage();

    const digest = await redirectDigest(
      RequestDetailPage({ params: Promise.resolve({ locale: 'en', id: REQUEST_ID }) }),
    );

    expect(digest).toMatch(/;404$/);
  });

  it('redirects to sign-in when the session expires between the check and the fetch', async () => {
    getSessionMock.mockResolvedValue({ id: 'user-1' });
    mockApi({ requestStatus: 401 });
    const RequestDetailPage = await loadPage();

    const digest = await redirectDigest(
      RequestDetailPage({ params: Promise.resolve({ locale: 'en', id: REQUEST_ID }) }),
    );

    expect(digest).toContain(encodeURIComponent(`/en/requests/${REQUEST_ID}`));
  });

  it('throws loudly when the request API fails unexpectedly', async () => {
    getSessionMock.mockResolvedValue({ id: 'user-1' });
    mockApi({ requestStatus: 500 });
    const RequestDetailPage = await loadPage();

    await expect(
      RequestDetailPage({ params: Promise.resolve({ locale: 'en', id: REQUEST_ID }) }),
    ).rejects.toThrow(/HTTP 500/);
  });

  it('throws loudly when the quotes API fails unexpectedly', async () => {
    getSessionMock.mockResolvedValue({ id: 'user-1' });
    mockApi({ request: REQUEST_ITEM, quotesStatus: 500 });
    const RequestDetailPage = await loadPage();

    await expect(
      RequestDetailPage({ params: Promise.resolve({ locale: 'en', id: REQUEST_ID }) }),
    ).rejects.toThrow(/quotes.*HTTP 500/i);
  });

  it('renders the request details, including line2 and the country, and passes quotes to the compare and card components', async () => {
    getSessionMock.mockResolvedValue({ id: 'client-1' });
    mockApi({ request: REQUEST_ITEM, quotes: [QUOTE] });
    const RequestDetailPage = await loadPage();
    const { QuoteCompare } = await import('@/components/requests/quote-compare');
    const { QuoteCard } = await import('@/components/requests/quote-card');
    const { CancelRequestButton } = await import('@/components/requests/cancel-request-button');

    const element = await RequestDetailPage({
      params: Promise.resolve({ locale: 'en', id: REQUEST_ID }),
    });
    const sectionChildren = (element.props as { children: unknown[] }).children;

    const compare = sectionChildren[2] as {
      type: unknown;
      props: { quotes: unknown[]; currentUserId: string };
    };
    expect(compare.type).toBe(QuoteCompare);
    expect(compare.props.quotes).toEqual([QUOTE]);
    expect(compare.props.currentUserId).toBe('client-1');

    const quotesSection = sectionChildren[3] as { props: { children: unknown[] } };
    const list = quotesSection.props.children[1] as { props: { children: unknown[] } };
    const [card] = list.props.children as [{ type: unknown; props: { quote: unknown } }];
    expect(card.type).toBe(QuoteCard);
    expect(card.props.quote).toEqual(QUOTE);

    const detailsDiv = sectionChildren[1] as { props: { children: unknown[] } };
    const cancelButton = detailsDiv.props.children.at(-1) as {
      type: unknown;
      props: { requestId: string; status: string };
    };
    expect(cancelButton.type).toBe(CancelRequestButton);
    expect(cancelButton.props).toEqual({ requestId: REQUEST_ID, status: 'quoted' });

    const dl = detailsDiv.props.children[2] as { props: { children: unknown[] } };
    const addressRow = dl.props.children[3] as { props: { children: unknown[] } };
    const addressDd = addressRow.props.children[1] as { props: { children: string[] } };
    const addressText = addressDd.props.children.join('');
    expect(addressText).toContain('Floor 2');
    expect(addressText).toContain('Luxembourg');
  });
});
