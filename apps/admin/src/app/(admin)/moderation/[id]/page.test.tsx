import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { MODERATOR_INITIATED_REPORT_REASON } from '@photoo/shared';

const serverApiMock = vi.fn();
vi.mock('@/lib/server-api', () => ({ serverApi: serverApiMock }));

const notFoundMock = vi.fn(() => {
  throw new Error('NEXT_NOT_FOUND');
});
vi.mock('next/navigation', () => ({ notFound: notFoundMock }));

vi.mock('next-intl/server', async () => {
  const { translate } = await import('@/testing/mock-translations');
  return {
    getTranslations: (namespace: string) => (key: string, values?: Record<string, unknown>) =>
      translate(namespace, key, values),
  };
});

const reportTargetSummaryMock = vi.fn(() => <div data-testid="report-target-summary" />);
const reportActionsMock = vi.fn(() => <div data-testid="report-actions" />);
const decisionHistoryMock = vi.fn(() => <div data-testid="decision-history" />);
vi.mock('./report-target-summary', () => ({ ReportTargetSummary: reportTargetSummaryMock }));
vi.mock('./report-actions', () => ({ ReportActions: reportActionsMock }));
vi.mock('./decision-history', () => ({ DecisionHistory: decisionHistoryMock }));

function firstCallProps(mock: { mock: { calls: unknown[][] } }) {
  return mock.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
}

async function loadPage() {
  const mod = await import('./page');
  return mod.default;
}

const report = {
  id: 'report-1',
  reporterId: 'user-1',
  targetType: 'request' as const,
  targetId: 'request-1',
  reason: 'This request looks fraudulent.',
  status: 'open' as const,
  adminId: null,
  resolution: null,
  createdAt: '2026-09-20T12:00:00.000Z',
  resolvedAt: null,
  target: {
    targetType: 'request' as const,
    title: 'Wedding photographer needed',
    description: 'Looking for someone in Luxembourg City.',
    deletedAt: null,
  },
};

function apiWith(reportResult: unknown, auditResult: unknown) {
  return vi.fn().mockImplementation((path: string) => {
    if (path === '/v1/admin/reports/{id}') {
      return reportResult;
    }
    if (path === '/v1/admin/audit-log') {
      return auditResult;
    }
    throw new Error(`Unexpected path ${path}`);
  });
}

describe('ReportDetailPage', () => {
  it('shows the reason and passes the report id as the audit-log target id', async () => {
    serverApiMock.mockResolvedValue({
      GET: apiWith(
        { data: report, response: { status: 200 } },
        { data: { items: [], nextCursor: null }, response: { status: 200 } },
      ),
    });
    const ReportDetailPage = await loadPage();

    render(await ReportDetailPage({ params: Promise.resolve({ id: 'report-1' }) }));

    expect(screen.getByText('This request looks fraudulent.')).toBeInTheDocument();
    expect(firstCallProps(reportTargetSummaryMock)).toMatchObject({
      targetType: 'request',
      target: report.target,
    });
    expect(firstCallProps(reportActionsMock)).toMatchObject({ report });
    expect(screen.getByTestId('decision-history')).toBeInTheDocument();
    expect(firstCallProps(decisionHistoryMock)).toEqual({ targetId: 'report-1' });
  });

  it('renders reason text literally, never as HTML', async () => {
    const htmlLookingReport = {
      ...report,
      reason: '<img src=x onerror=alert(1)>',
    };
    serverApiMock.mockResolvedValue({
      GET: apiWith(
        { data: htmlLookingReport, response: { status: 200 } },
        { data: { items: [], nextCursor: null }, response: { status: 200 } },
      ),
    });
    const ReportDetailPage = await loadPage();

    render(await ReportDetailPage({ params: Promise.resolve({ id: 'report-1' }) }));

    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(document.querySelector('img[src="x"]')).not.toBeInTheDocument();
  });

  it('renders a moderator-initiated report with an explanation, not the raw sentinel', async () => {
    const directReport = {
      ...report,
      reporterId: null,
      reason: MODERATOR_INITIATED_REPORT_REASON,
    };
    serverApiMock.mockResolvedValue({
      GET: apiWith(
        { data: directReport, response: { status: 200 } },
        { data: { items: [], nextCursor: null }, response: { status: 200 } },
      ),
    });
    const ReportDetailPage = await loadPage();

    render(await ReportDetailPage({ params: Promise.resolve({ id: 'report-1' }) }));

    expect(screen.getByText('Found by a moderator')).toBeInTheDocument();
    expect(
      screen.getByText('No public report was filed. A moderator identified this content directly.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(MODERATOR_INITIATED_REPORT_REASON)).not.toBeInTheDocument();
  });

  it('hides decision history when the audit-log probe is forbidden', async () => {
    serverApiMock.mockResolvedValue({
      GET: apiWith(
        { data: report, response: { status: 200 } },
        { data: undefined, response: { status: 403 } },
      ),
    });
    const ReportDetailPage = await loadPage();

    render(await ReportDetailPage({ params: Promise.resolve({ id: 'report-1' }) }));

    expect(screen.queryByTestId('decision-history')).not.toBeInTheDocument();
  });

  it('calls notFound for a missing report', async () => {
    serverApiMock.mockResolvedValue({
      GET: vi.fn().mockResolvedValueOnce({ data: undefined, response: { status: 404 } }),
    });
    const ReportDetailPage = await loadPage();

    await expect(ReportDetailPage({ params: Promise.resolve({ id: 'missing' }) })).rejects.toThrow(
      'NEXT_NOT_FOUND',
    );
    expect(notFoundMock).toHaveBeenCalled();
  });

  it('throws on an unexpected failure instead of silently degrading', async () => {
    serverApiMock.mockResolvedValue({
      GET: vi.fn().mockResolvedValueOnce({ data: undefined, response: { status: 500 } }),
    });
    const ReportDetailPage = await loadPage();

    await expect(ReportDetailPage({ params: Promise.resolve({ id: 'report-1' }) })).rejects.toThrow(
      /HTTP 500/,
    );
  });
});
