import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next-intl', async () => {
  const { mockUseTranslations } = await import('@/testing/mock-translations');
  return { useTranslations: mockUseTranslations };
});

const getMock = vi.fn();
vi.mock('@/lib/api', () => ({ api: { GET: getMock } }));

// See suspend-dialog.test.tsx: a static import of the component under test
// would resolve '@/lib/api' - and read `getMock` - before the `const
// getMock` above is initialized.
async function loadAuditTrail() {
  return (await import('./audit-trail')).AuditTrail;
}

const entry = {
  id: 'entry-1',
  actorId: 'admin-1',
  action: 'user.suspended',
  targetType: 'User',
  targetId: 'user-1',
  before: null,
  after: null,
  ip: null,
  occurredAt: '2026-09-01T00:00:00.000Z',
};

describe('AuditTrail', () => {
  it('shows the entries scoped to the target user', async () => {
    getMock.mockResolvedValueOnce({ data: { items: [entry], nextCursor: null } });
    const AuditTrail = await loadAuditTrail();

    render(<AuditTrail targetId="user-1" />);

    expect(await screen.findByText('user.suspended')).toBeInTheDocument();
    expect(screen.getByText('2026-09-01T00:00:00.000Z')).toBeInTheDocument();
    expect(getMock).toHaveBeenCalledWith('/v1/admin/audit-log', {
      params: { query: { targetId: 'user-1' } },
    });
  });

  it('advances by cursor and does not refetch page one on back', async () => {
    getMock.mockResolvedValueOnce({
      data: { items: [entry], nextCursor: 'page-2' },
    });
    getMock.mockResolvedValueOnce({
      data: { items: [{ ...entry, id: 'entry-2', action: 'user.reactivated' }], nextCursor: null },
    });
    const AuditTrail = await loadAuditTrail();
    render(<AuditTrail targetId="user-1" />);
    await screen.findByText('user.suspended');

    const events = userEvent.setup();
    await events.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('user.reactivated')).toBeInTheDocument();
    expect(getMock).toHaveBeenCalledTimes(2);

    await events.click(screen.getByRole('button', { name: 'Previous' }));
    expect(await screen.findByText('user.suspended')).toBeInTheDocument();
    expect(getMock).toHaveBeenCalledTimes(2);
  });

  it('shows the empty state with no entries', async () => {
    getMock.mockResolvedValueOnce({ data: { items: [], nextCursor: null } });
    const AuditTrail = await loadAuditTrail();

    render(<AuditTrail targetId="user-1" />);

    expect(await screen.findByText('No audit log entries for this user.')).toBeInTheDocument();
  });
});
