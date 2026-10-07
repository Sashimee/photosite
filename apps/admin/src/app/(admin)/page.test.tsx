import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const getSessionMock = vi.fn();
const getMock = vi.fn();

vi.mock('@/lib/server-api', () => ({
  getSession: getSessionMock,
  serverApi: () => Promise.resolve({ GET: getMock }),
}));
vi.mock('next-intl/server', async () => {
  const { mockUseFormatter, translate } = await import('@/testing/mock-translations');
  return {
    getTranslations: (namespace: string) => (key: string, values?: Record<string, unknown>) =>
      translate(namespace, key, values),
    getFormatter: () => mockUseFormatter(),
  };
});

const zero = { current: 0, previous: 0 };
const baseDashboard = {
  window: '30d',
  generatedAt: '2026-10-07T10:00:00.000Z',
  signups: { total: zero, client: zero, photographer: zero, professional: zero },
  activity: { requests: zero, quotes: zero, bookings: zero },
  money: null,
  backlogs: { verification: 0, provenance: 0, reports: 0, dataRequests: 0 },
};

type Dashboard = Omit<typeof baseDashboard, 'money'> & { money: unknown };

function mockApi(overrides: Partial<Dashboard> = {}, permissions: string[] = []) {
  const dashboard = { ...baseDashboard, ...overrides };
  getMock.mockImplementation((path: string) =>
    Promise.resolve(
      path === '/v1/admin/me'
        ? { data: { permissions }, response: { status: 200 } }
        : { data: dashboard, response: { status: 200 } },
    ),
  );
}

async function renderPage(searchParams: { window?: string | string[] } = {}) {
  getSessionMock.mockResolvedValue({ email: 'admin@example.com' });
  const AdminHomePage = await loadPage();
  render(await AdminHomePage({ searchParams: Promise.resolve(searchParams) }));
}

function cardFor(label: string): HTMLElement {
  const card = screen.getByText(label).closest('div');
  if (!card) {
    throw new Error(`no card found for ${label}`);
  }
  return card;
}

function metricSection(name: string | RegExp) {
  const section = screen.getByRole('heading', { name }).parentElement;
  if (!section) {
    throw new Error(`no section found for ${String(name)}`);
  }
  return within(section);
}

function sentWindows(): string[] {
  return dashboardCalls().map(
    (call) => (call[1] as { params: { query: { window: string } } }).params.query.window,
  );
}

function dashboardCalls() {
  return getMock.mock.calls.filter(([path]) => path === '/v1/admin/dashboard');
}

async function loadPage() {
  const mod = await import('./page');
  return mod.default;
}

describe('AdminHomePage', () => {
  afterEach(() => {
    vi.resetModules();
    getSessionMock.mockReset();
    getMock.mockReset();
  });

  it('shows who is signed in', async () => {
    getSessionMock.mockResolvedValue({ email: 'admin@example.com' });
    mockApi();
    const AdminHomePage = await loadPage();

    render(await AdminHomePage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByText('Signed in as admin@example.com')).toBeInTheDocument();
  });

  it('throws loudly instead of rendering with no session', async () => {
    getSessionMock.mockResolvedValue(null);
    const AdminHomePage = await loadPage();

    await expect(AdminHomePage({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      /without a session/,
    );
  });

  it('renders every sign-up, activity, money and backlog card', async () => {
    mockApi({
      money: { gmv: [], refunds: [], feeRevenue: [] },
    });

    await renderPage();

    for (const label of [
      'All new accounts',
      'Clients',
      'Photographers',
      'Professionals',
      'Requests created',
      'Quotes sent',
      'Bookings paid',
      'Verification cases awaiting review',
      'Provenance checks awaiting review',
      'Open reports',
      'Open data requests',
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    for (const heading of ['Sign-ups', 'Activity', 'Money', 'Backlogs']) {
      expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument();
    }
    expect(screen.getAllByText('No money movement recorded')).toHaveLength(3);
  });

  describe('deltas', () => {
    it('shows the current value and the previous value beside it', async () => {
      mockApi({
        signups: {
          total: { current: 1234, previous: 1000 },
          client: zero,
          photographer: zero,
          professional: zero,
        },
      });

      await renderPage();

      const card = within(cardFor('All new accounts'));
      expect(card.getByText('1,234')).toBeInTheDocument();
      expect(card.getByText('Previous: 1,000')).toBeInTheDocument();
    });

    it('shows an increase as a percentage up', async () => {
      mockApi({
        activity: { requests: { current: 15, previous: 10 }, quotes: zero, bookings: zero },
      });

      await renderPage();

      expect(within(cardFor('Requests created')).getByText('Up 50%')).toBeInTheDocument();
    });

    it('shows a decrease as a percentage down, without a minus sign', async () => {
      mockApi({
        activity: { requests: { current: 5, previous: 10 }, quotes: zero, bookings: zero },
      });

      await renderPage();

      expect(within(cardFor('Requests created')).getByText('Down 50%')).toBeInTheDocument();
    });

    it('shows no change when both windows are equal', async () => {
      mockApi({
        activity: { requests: { current: 7, previous: 7 }, quotes: zero, bookings: zero },
      });

      await renderPage();

      expect(within(cardFor('Requests created')).getByText('No change')).toBeInTheDocument();
    });

    it('shows no change, not New, when both windows are zero', async () => {
      mockApi();

      await renderPage();

      const card = within(cardFor('Requests created'));
      expect(card.getByText('No change')).toBeInTheDocument();
      expect(card.queryByText('New')).not.toBeInTheDocument();
    });

    it('shows New, not a percentage, when the previous window is zero', async () => {
      mockApi({
        activity: { requests: { current: 3, previous: 0 }, quotes: zero, bookings: zero },
      });

      await renderPage();

      const card = within(cardFor('Requests created'));
      expect(card.getByText('New')).toBeInTheDocument();
      expect(card.queryByText(/%|Infinity|NaN/)).not.toBeInTheDocument();
    });

    it('shows a decrease to zero as Down 100%', async () => {
      mockApi({
        activity: { requests: { current: 0, previous: 4 }, quotes: zero, bookings: zero },
      });

      await renderPage();

      expect(within(cardFor('Requests created')).getByText('Down 100%')).toBeInTheDocument();
    });
  });

  describe('money', () => {
    it('shows the finance notice and no money figures when money is null', async () => {
      mockApi({ money: null });

      await renderPage();

      expect(screen.getByText('Money figures require the finance permission.')).toBeInTheDocument();
      expect(screen.queryByText('GMV')).not.toBeInTheDocument();
      expect(screen.queryByText('No money movement recorded')).not.toBeInTheDocument();
    });

    it('shows one card per currency under each money metric, formatted from cents', async () => {
      mockApi({
        money: {
          gmv: [
            { currency: 'EUR', current: 123456, previous: 100000 },
            { currency: 'USD', current: 2500, previous: 0 },
          ],
          refunds: [{ currency: 'EUR', current: 1500, previous: 3000 }],
          feeRevenue: [],
        },
      });

      await renderPage();

      expect(screen.queryByText('Money figures require the finance permission.')).toBeNull();
      const gmv = metricSection('GMV');
      expect(gmv.getByText('€1,234.56')).toBeInTheDocument();
      expect(gmv.getAllByText(/^(EUR|USD)$/)).toHaveLength(2);
      expect(gmv.getByText('Previous: €1,000.00')).toBeInTheDocument();
      expect(gmv.getByText('$25.00')).toBeInTheDocument();
      expect(gmv.getByText('New')).toBeInTheDocument();
      expect(gmv.getByText('Up 23%')).toBeInTheDocument();
      expect(screen.getByText('No money movement recorded')).toBeInTheDocument();
    });

    it('shows positive refund magnitudes as-is, with no double negation', async () => {
      mockApi({
        money: {
          gmv: [],
          refunds: [{ currency: 'EUR', current: 1500, previous: 3000 }],
          feeRevenue: [{ currency: 'EUR', current: 625, previous: 0 }],
        },
      });

      await renderPage();

      const refunds = metricSection('Refunds');
      expect(refunds.getByText('€15.00')).toBeInTheDocument();
      expect(refunds.getByText('Previous: €30.00')).toBeInTheDocument();
      expect(refunds.getByText('Down 50%')).toBeInTheDocument();
      const fees = metricSection(/Fee revenue/);
      expect(fees.getByText('€6.25')).toBeInTheDocument();
      expect(document.body.textContent).not.toMatch(/-\s?€|€\s?-|−/);
    });
  });

  describe('backlog links', () => {
    const queueLinks = () => screen.queryAllByRole('link', { name: 'Open queue' });

    function backlogItem(label: string) {
      const item = screen.getByText(label).closest('li');
      if (!item) {
        throw new Error(`no backlog item for ${label}`);
      }
      return within(item);
    }

    it('shows each backlog count', async () => {
      mockApi({ backlogs: { verification: 4, provenance: 3, reports: 2, dataRequests: 1 } });

      await renderPage();

      expect(backlogItem('Verification cases awaiting review').getByText('4')).toBeInTheDocument();
      expect(backlogItem('Provenance checks awaiting review').getByText('3')).toBeInTheDocument();
      expect(backlogItem('Open reports').getByText('2')).toBeInTheDocument();
      expect(backlogItem('Open data requests').getByText('1')).toBeInTheDocument();
    });

    it('links to no queue when the admin holds no queue permission', async () => {
      mockApi({}, ['finance']);

      await renderPage();

      expect(queueLinks()).toHaveLength(0);
    });

    it('links only to queues the admin can open (moderation covers provenance and reports)', async () => {
      mockApi({}, ['moderation']);

      await renderPage();

      expect(
        backlogItem('Provenance checks awaiting review').getByRole('link', { name: 'Open queue' }),
      ).toHaveAttribute('href', '/provenance');
      expect(backlogItem('Open reports').getByRole('link', { name: 'Open queue' })).toHaveAttribute(
        'href',
        '/moderation',
      );
      expect(
        backlogItem('Verification cases awaiting review').queryByRole('link'),
      ).not.toBeInTheDocument();
      expect(backlogItem('Open data requests').queryByRole('link')).not.toBeInTheDocument();
      expect(queueLinks()).toHaveLength(2);
    });

    it('links verification and data requests for their own permissions', async () => {
      mockApi({}, ['verification', 'support']);

      await renderPage();

      expect(
        backlogItem('Verification cases awaiting review').getByRole('link', { name: 'Open queue' }),
      ).toHaveAttribute('href', '/verification');
      expect(
        backlogItem('Open data requests').getByRole('link', { name: 'Open queue' }),
      ).toHaveAttribute('href', '/data-requests');
      expect(queueLinks()).toHaveLength(2);
    });

    it('links all four queues with all four queue permissions', async () => {
      mockApi({}, ['verification', 'moderation', 'support']);

      await renderPage();

      expect(queueLinks()).toHaveLength(4);
    });
  });

  describe('window', () => {
    it.each(['7d', '30d', '90d'])('requests the %s window from the API', async (window) => {
      mockApi();

      await renderPage({ window });

      expect(dashboardCalls()).toHaveLength(1);
      expect(dashboardCalls()[0]?.[1]).toMatchObject({ params: { query: { window } } });
    });

    it('defaults to 30d when no window param is given', async () => {
      mockApi();

      await renderPage();

      expect(dashboardCalls()[0]?.[1]).toMatchObject({ params: { query: { window: '30d' } } });
      expect(screen.getByRole('link', { name: 'Last 30 days' })).toHaveAttribute(
        'aria-current',
        'true',
      );
    });

    it.each([['14d'], ['abc'], [''], ['30D'], [['7d', '90d']]])(
      'falls back to 30d for invalid window %j and never sends it to the API',
      async (raw) => {
        mockApi();

        await renderPage({ window: raw });

        const sent = sentWindows();
        expect(sent).toEqual(['30d']);
        expect(screen.getByRole('link', { name: 'Last 30 days' })).toHaveAttribute(
          'aria-current',
          'true',
        );
        expect(screen.getByText(/Compared with the previous 30 days/)).toBeInTheDocument();
      },
    );

    it('links to each window and marks only the active one as current', async () => {
      mockApi();

      await renderPage({ window: '7d' });

      const nav = within(screen.getByRole('navigation', { name: 'Time window' }));
      expect(nav.getByRole('link', { name: 'Last 7 days' })).toHaveAttribute('href', '/?window=7d');
      expect(nav.getByRole('link', { name: 'Last 30 days' })).toHaveAttribute(
        'href',
        '/?window=30d',
      );
      expect(nav.getByRole('link', { name: 'Last 90 days' })).toHaveAttribute(
        'href',
        '/?window=90d',
      );
      expect(nav.getByRole('link', { name: 'Last 7 days' })).toHaveAttribute(
        'aria-current',
        'true',
      );
      expect(nav.getByRole('link', { name: 'Last 30 days' })).not.toHaveAttribute('aria-current');
      expect(nav.getByRole('link', { name: 'Last 90 days' })).not.toHaveAttribute('aria-current');
      expect(screen.getByText(/Compared with the previous 7 days/)).toBeInTheDocument();
    });
  });

  it('throws loudly when the dashboard request fails', async () => {
    getSessionMock.mockResolvedValue({ email: 'admin@example.com' });
    getMock.mockImplementation((path: string) =>
      Promise.resolve(
        path === '/v1/admin/me'
          ? { data: { permissions: [] }, response: { status: 200 } }
          : { data: undefined, response: { status: 403 } },
      ),
    );
    const AdminHomePage = await loadPage();

    await expect(AdminHomePage({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      /Dashboard lookup failed with HTTP 403/,
    );
  });
});
