import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next-intl', async () => {
  const { mockUseTranslations } = await import('@/testing/mock-translations');
  return { useTranslations: mockUseTranslations };
});

const postMock = vi.fn();
vi.mock('@/lib/api', () => ({ api: { POST: postMock } }));

// See suspend-dialog.test.tsx: a static import of the component under test
// would resolve '@/lib/api' - and read `postMock` - before the `const
// postMock` above is initialized.
async function loadClaimPanel() {
  return (await import('./claim-panel')).ClaimPanel;
}

describe('ClaimPanel', () => {
  it('offers to start review on an unclaimed, submitted case', async () => {
    const ClaimPanel = await loadClaimPanel();

    render(
      <ClaimPanel
        caseId="case-1"
        status="submitted"
        assignedAdminId={null}
        currentAdminId="admin-1"
        onClaimed={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Start review' })).toBeInTheDocument();
  });

  it('claims the case and calls onClaimed on success', async () => {
    postMock.mockResolvedValueOnce({ data: { id: 'case-1', status: 'in_review' } });
    const onClaimed = vi.fn();
    const ClaimPanel = await loadClaimPanel();
    const events = userEvent.setup();

    render(
      <ClaimPanel
        caseId="case-1"
        status="submitted"
        assignedAdminId={null}
        currentAdminId="admin-1"
        onClaimed={onClaimed}
      />,
    );
    await events.click(screen.getByRole('button', { name: 'Start review' }));

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledWith('/v1/admin/verification-cases/{id}/start-review', {
        params: { path: { id: 'case-1' } },
      });
    });
    await waitFor(() => {
      expect(onClaimed).toHaveBeenCalled();
    });
  });

  it('warns and refreshes when another admin claimed the case first', async () => {
    postMock.mockResolvedValueOnce({ error: { code: 'CONFLICT' } });
    const onClaimed = vi.fn();
    const ClaimPanel = await loadClaimPanel();
    const events = userEvent.setup();

    render(
      <ClaimPanel
        caseId="case-1"
        status="submitted"
        assignedAdminId={null}
        currentAdminId="admin-1"
        onClaimed={onClaimed}
      />,
    );
    await events.click(screen.getByRole('button', { name: 'Start review' }));

    expect(
      await screen.findByText('This case was claimed by another admin while you were viewing it.'),
    ).toBeInTheDocument();
    expect(onClaimed).toHaveBeenCalled();
  });

  it('shows a warning, not the start button, for a case another admin is already reviewing', async () => {
    const ClaimPanel = await loadClaimPanel();

    render(
      <ClaimPanel
        caseId="case-1"
        status="in_review"
        assignedAdminId="admin-2"
        currentAdminId="admin-1"
        onClaimed={vi.fn()}
      />,
    );

    expect(
      screen.getByText(
        'Another admin is already reviewing this case. You can still review it, but coordinate with them first to avoid duplicate work.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start review' })).not.toBeInTheDocument();
  });

  it('tells the current admin they are the one reviewing when they hold the claim', async () => {
    const ClaimPanel = await loadClaimPanel();

    render(
      <ClaimPanel
        caseId="case-1"
        status="in_review"
        assignedAdminId="admin-1"
        currentAdminId="admin-1"
        onClaimed={vi.fn()}
      />,
    );

    expect(screen.getByText('You are reviewing this case.')).toBeInTheDocument();
  });

  it('routes a stale second factor to re-verification instead of showing a toast', async () => {
    postMock.mockResolvedValueOnce({ error: { code: 'TWO_FACTOR_REQUIRED' } });
    const onClaimed = vi.fn();
    const ClaimPanel = await loadClaimPanel();
    const events = userEvent.setup();

    render(
      <ClaimPanel
        caseId="case-1"
        status="submitted"
        assignedAdminId={null}
        currentAdminId="admin-1"
        onClaimed={onClaimed}
      />,
    );
    await events.click(screen.getByRole('button', { name: 'Start review' }));

    await waitFor(() => {
      expect(postMock).toHaveBeenCalled();
    });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(onClaimed).not.toHaveBeenCalled();
  });
});
