import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next-intl', async () => {
  const { mockUseFormatter, mockUseTranslations } = await import('@/testing/mock-translations');
  return { useTranslations: mockUseTranslations, useFormatter: mockUseFormatter };
});

const getMock = vi.fn();
vi.mock('@/lib/api', () => ({ api: { GET: getMock } }));

// See suspend-dialog.test.tsx in apps/admin/src/app/(admin)/users/[id]: a
// static import of the component under test would resolve '@/lib/api' -
// and read `getMock` - before the `const getMock` above is initialized.
async function loadDecisionHistory() {
  return (await import('./decision-history')).DecisionHistory;
}

const entry = {
  id: 'entry-1',
  actorId: 'admin-1',
  action: 'report.resolved',
  targetType: 'Report',
  targetId: 'report-1',
  before: null,
  after: null,
  ip: null,
  occurredAt: '2026-09-01T00:00:00.000Z',
};

describe('DecisionHistory', () => {
  it('shows the entries scoped to the report', async () => {
    getMock.mockResolvedValueOnce({ data: { items: [entry], nextCursor: null } });
    const DecisionHistory = await loadDecisionHistory();

    render(<DecisionHistory targetId="report-1" />);

    expect(await screen.findByText('report.resolved')).toBeInTheDocument();
    expect(screen.getByText('Sep 1, 2026, 2:00 AM GMT+2')).toBeInTheDocument();
    expect(getMock).toHaveBeenCalledWith('/v1/admin/audit-log', {
      params: { query: { targetId: 'report-1' } },
    });
  });

  it('shows the empty state with no entries', async () => {
    getMock.mockResolvedValueOnce({ data: { items: [], nextCursor: null } });
    const DecisionHistory = await loadDecisionHistory();

    render(<DecisionHistory targetId="report-1" />);

    expect(await screen.findByText('No audit log entries for this report.')).toBeInTheDocument();
  });
});
