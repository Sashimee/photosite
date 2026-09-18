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
async function loadApproveDialog() {
  return (await import('./approve-dialog')).ApproveDialog;
}

async function openDialog() {
  const ApproveDialog = await loadApproveDialog();
  const events = userEvent.setup();
  render(<ApproveDialog caseId="case-1" applicantId="user-1" onApproved={vi.fn()} />);
  await events.click(screen.getByRole('button', { name: 'Approve' }));
  return events;
}

describe('ApproveDialog', () => {
  it('names the applicant in the confirmation', async () => {
    await openDialog();

    expect(screen.getByText('Approve this verification?')).toBeInTheDocument();
    expect(screen.getByText(/user-1/)).toBeInTheDocument();
  });

  it('approves the case and calls onApproved on success', async () => {
    postMock.mockResolvedValueOnce({ data: { id: 'case-1', status: 'approved' } });
    const onApproved = vi.fn();
    const ApproveDialog = await loadApproveDialog();
    const events = userEvent.setup();
    render(<ApproveDialog caseId="case-1" applicantId="user-1" onApproved={onApproved} />);
    await events.click(screen.getByRole('button', { name: 'Approve' }));
    await events.click(screen.getByRole('button', { name: 'Approve verification' }));

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledWith('/v1/admin/verification-cases/{id}/approve', {
        params: { path: { id: 'case-1' } },
      });
    });
    await waitFor(() => {
      expect(onApproved).toHaveBeenCalled();
    });
  });

  it('routes a stale second factor to re-verification instead of showing a toast', async () => {
    postMock.mockResolvedValueOnce({ error: { code: 'TWO_FACTOR_REQUIRED' } });
    const onApproved = vi.fn();
    const ApproveDialog = await loadApproveDialog();
    const events = userEvent.setup();
    render(<ApproveDialog caseId="case-1" applicantId="user-1" onApproved={onApproved} />);
    await events.click(screen.getByRole('button', { name: 'Approve' }));
    await events.click(screen.getByRole('button', { name: 'Approve verification' }));

    await waitFor(() => {
      expect(postMock).toHaveBeenCalled();
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(onApproved).not.toHaveBeenCalled();
  });
});
