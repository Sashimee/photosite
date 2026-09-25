import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next-intl', async () => {
  const { mockUseTranslations } = await import('@/testing/mock-translations');
  return { useTranslations: mockUseTranslations };
});

const getMock = vi.fn();
const postMock = vi.fn();
vi.mock('@/lib/api', () => ({ api: { GET: getMock, POST: postMock } }));

import type { components } from '@photoo/api-client';

type AdminReport = components['schemas']['AdminReport'];

// See suspend-dialog.test.tsx: a static import here would resolve '@/lib/api'
// - and read `getMock`/`postMock` - before the consts above are initialized.
async function loadReportActions() {
  return (await import('./report-actions')).ReportActions;
}

const openReport: AdminReport = {
  id: 'report-1',
  reporterId: 'user-1',
  targetType: 'photographer_profile',
  targetId: 'profile-1',
  reason: 'Impersonation.',
  status: 'open',
  adminId: null,
  resolution: null,
  createdAt: '2026-09-20T12:00:00.000Z',
  resolvedAt: null,
  target: {
    targetType: 'photographer_profile',
    displayName: 'Jane Doe Photography',
    slug: 'jane-doe-photography',
    isPublished: true,
    deletedAt: null,
  },
};

const takenDownReport: AdminReport = {
  ...openReport,
  target: {
    targetType: 'photographer_profile',
    displayName: 'Jane Doe Photography',
    slug: 'jane-doe-photography',
    isPublished: true,
    deletedAt: '2026-09-21T00:00:00.000Z',
  },
};

describe('ReportActions', () => {
  it('offers resolve, dismiss and takedown for an open report whose target is live', async () => {
    const ReportActions = await loadReportActions();
    render(<ReportActions report={openReport} />);

    expect(screen.getByRole('button', { name: 'Resolve' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Take down' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Restore' })).not.toBeInTheDocument();
  });

  it('offers restore instead of takedown once the target is already taken down', async () => {
    const ReportActions = await loadReportActions();
    render(<ReportActions report={takenDownReport} />);

    expect(screen.getByRole('button', { name: 'Restore' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Take down' })).not.toBeInTheDocument();
  });

  it('offers no decision buttons for a resolved report whose target was never taken down', async () => {
    const ReportActions = await loadReportActions();
    render(<ReportActions report={{ ...openReport, status: 'resolved', adminId: 'admin-2' }} />);

    expect(screen.queryByRole('button', { name: 'Resolve' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Dismiss' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Take down' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Restore' })).not.toBeInTheDocument();
  });

  it('still offers restore on a resolved report whose target is taken down', async () => {
    const ReportActions = await loadReportActions();
    render(
      <ReportActions report={{ ...takenDownReport, status: 'resolved', adminId: 'admin-2' }} />,
    );

    expect(screen.getByRole('button', { name: 'Restore' })).toBeInTheDocument();
  });

  it('offers only resolve and dismiss when the target row is gone', async () => {
    const ReportActions = await loadReportActions();
    render(<ReportActions report={{ ...openReport, target: null }} />);

    expect(screen.getByRole('button', { name: 'Resolve' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Take down' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Restore' })).not.toBeInTheDocument();
  });

  it('shows who resolved a report and refreshes when a resolve races another admin', async () => {
    postMock.mockResolvedValueOnce({ error: { code: 'CONFLICT' } });
    getMock.mockResolvedValueOnce({
      data: { ...openReport, status: 'resolved', adminId: 'admin-9' },
      response: { status: 200 },
    });
    const ReportActions = await loadReportActions();
    const events = userEvent.setup();
    render(<ReportActions report={openReport} />);

    await events.click(screen.getByRole('button', { name: 'Resolve' }));
    await events.type(screen.getByLabelText(/Statement of reasons/), 'Reviewed and closing.');
    await events.click(screen.getByRole('button', { name: 'Resolve report' }));

    expect(
      await screen.findByText('This report was already resolved by admin-9.'),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Resolve' })).not.toBeInTheDocument();
    });
  });

  it('shows a not-taken-down notice and refreshes when a restore races another admin', async () => {
    postMock.mockResolvedValueOnce({ error: { code: 'CONFLICT' } });
    getMock.mockResolvedValueOnce({ data: openReport, response: { status: 200 } });
    const ReportActions = await loadReportActions();
    const events = userEvent.setup();
    render(<ReportActions report={takenDownReport} />);

    await events.click(screen.getByRole('button', { name: 'Restore' }));
    await events.type(screen.getByLabelText(/Statement of reasons/), 'Reversing this.');
    await events.click(screen.getByRole('button', { name: 'Restore content' }));

    expect(
      await screen.findByText('This target is no longer taken down; there is nothing to restore.'),
    ).toBeInTheDocument();
  });
});
