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
async function loadRejectDialog() {
  return (await import('./reject-dialog')).RejectDialog;
}

async function openDialog() {
  const RejectDialog = await loadRejectDialog();
  const events = userEvent.setup();
  render(<RejectDialog caseId="case-1" applicantId="user-1" onRejected={vi.fn()} />);
  await events.click(screen.getByRole('button', { name: 'Reject' }));
  return events;
}

describe('RejectDialog', () => {
  it('tells the reviewer the explanation is shown to the applicant', async () => {
    await openDialog();

    expect(
      screen.getByText(
        'Shown to the applicant together with the category above. Write it for them.',
      ),
    ).toBeInTheDocument();
  });

  it('requires both a category and text before it will submit', async () => {
    const events = await openDialog();

    await events.click(screen.getByRole('button', { name: 'Reject verification' }));

    expect(await screen.findAllByText('This field is required.')).toHaveLength(2);
    expect(postMock).not.toHaveBeenCalled();
  });

  it('requires text even once a category is chosen', async () => {
    const events = await openDialog();

    await events.selectOptions(screen.getByLabelText('Reason category'), 'illegible');
    await events.click(screen.getByRole('button', { name: 'Reject verification' }));

    expect(await screen.findAllByText('This field is required.')).toHaveLength(1);
    expect(postMock).not.toHaveBeenCalled();
  });

  it('composes the category and text into the single reason the API accepts', async () => {
    postMock.mockResolvedValueOnce({ data: { id: 'case-1', status: 'rejected' } });
    const onRejected = vi.fn();
    const RejectDialog = await loadRejectDialog();
    const events = userEvent.setup();
    render(<RejectDialog caseId="case-1" applicantId="user-1" onRejected={onRejected} />);
    await events.click(screen.getByRole('button', { name: 'Reject' }));

    await events.selectOptions(screen.getByLabelText('Reason category'), 'illegible');
    await events.type(screen.getByLabelText('Explanation'), 'The photo page is unreadable.');
    await events.click(screen.getByRole('button', { name: 'Reject verification' }));

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledWith('/v1/admin/verification-cases/{id}/reject', {
        params: { path: { id: 'case-1' } },
        body: { reason: 'Illegible document: The photo page is unreadable.' },
      });
    });
    await waitFor(() => {
      expect(onRejected).toHaveBeenCalled();
    });
  });

  it('routes a stale second factor to re-verification instead of showing a toast', async () => {
    postMock.mockResolvedValueOnce({ error: { code: 'TWO_FACTOR_REQUIRED' } });
    const onRejected = vi.fn();
    const RejectDialog = await loadRejectDialog();
    const events = userEvent.setup();
    render(<RejectDialog caseId="case-1" applicantId="user-1" onRejected={onRejected} />);
    await events.click(screen.getByRole('button', { name: 'Reject' }));

    await events.selectOptions(screen.getByLabelText('Reason category'), 'illegible');
    await events.type(screen.getByLabelText('Explanation'), 'The photo page is unreadable.');
    await events.click(screen.getByRole('button', { name: 'Reject verification' }));

    await waitFor(() => {
      expect(postMock).toHaveBeenCalled();
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(onRejected).not.toHaveBeenCalled();
  });
});
