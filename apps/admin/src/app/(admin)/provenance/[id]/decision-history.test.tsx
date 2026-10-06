import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next-intl', async () => {
  const { mockUseFormatter, mockUseTranslations } = await import('@/testing/mock-translations');
  return { useTranslations: mockUseTranslations, useFormatter: mockUseFormatter };
});

const getMock = vi.fn();
vi.mock('@/lib/api', () => ({ api: { GET: getMock } }));

async function loadDecisionHistory() {
  return (await import('./decision-history')).DecisionHistory;
}

function entry(id: string, action: string, actorId: string | null) {
  return {
    id,
    actorId,
    action,
    targetType: 'ProvenanceCheck',
    targetId: 'check-1',
    before: null,
    after: null,
    ip: null,
    occurredAt: '2026-09-01T00:00:00.000Z',
  };
}

beforeEach(() => {
  getMock.mockReset();
});

describe('DecisionHistory', () => {
  it('lists entries scoped to the check and labels a missing actor as System', async () => {
    getMock.mockResolvedValueOnce({
      data: {
        items: [
          entry('e1', 'provenance.approved', 'admin-1'),
          entry('e2', 'provenance.rechecked', null),
        ],
        nextCursor: null,
      },
    });
    const DecisionHistory = await loadDecisionHistory();

    render(<DecisionHistory targetId="check-1" />);

    expect(await screen.findByText('provenance.approved')).toBeInTheDocument();
    expect(screen.getByText('admin-1')).toBeInTheDocument();
    expect(screen.getByText('System')).toBeInTheDocument();
    expect(screen.getByText('provenance.rechecked')).toBeInTheDocument();
    expect(getMock).toHaveBeenCalledWith('/v1/admin/audit-log', {
      params: { query: { targetId: 'check-1' } },
    });
  });

  it('shows the empty state with no entries', async () => {
    getMock.mockResolvedValueOnce({ data: { items: [], nextCursor: null } });
    const DecisionHistory = await loadDecisionHistory();

    render(<DecisionHistory targetId="check-1" />);

    expect(await screen.findByText('No decisions recorded yet.')).toBeInTheDocument();
  });

  it('passes the cursor through when paging, keeping the target filter', async () => {
    getMock
      .mockResolvedValueOnce({
        data: { items: [entry('e1', 'provenance.approved', 'admin-1')], nextCursor: 'c2' },
      })
      .mockResolvedValueOnce({
        data: { items: [entry('e2', 'provenance.flagged', 'admin-2')], nextCursor: null },
      });
    const DecisionHistory = await loadDecisionHistory();
    const events = userEvent.setup();

    render(<DecisionHistory targetId="check-1" />);
    await screen.findByText('provenance.approved');
    await events.click(screen.getByRole('button', { name: 'Next' }));

    expect(await screen.findByText('provenance.flagged')).toBeInTheDocument();
    expect(getMock).toHaveBeenLastCalledWith('/v1/admin/audit-log', {
      params: { query: { targetId: 'check-1', cursor: 'c2' } },
    });
  });

  it('shows a retryable error when the audit log request fails', async () => {
    getMock.mockResolvedValueOnce({ error: { code: 'FORBIDDEN' } });
    const DecisionHistory = await loadDecisionHistory();

    render(<DecisionHistory targetId="check-1" />);

    expect(await screen.findByRole('alert')).toHaveTextContent("You don't have permission");
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});
