import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next-intl', async () => {
  const { mockUseTranslations } = await import('@/testing/mock-translations');
  return { useTranslations: mockUseTranslations };
});

const postMock = vi.fn();
vi.mock('@/lib/api', () => ({ api: { POST: postMock } }));

async function loadRestoreDialog() {
  return (await import('./restore-dialog')).RestoreDialog;
}

async function openDialog(targetLabel = 'Jane Doe Photography') {
  const RestoreDialog = await loadRestoreDialog();
  const events = userEvent.setup();
  render(
    <RestoreDialog
      reportId="report-1"
      targetLabel={targetLabel}
      onRestored={vi.fn()}
      onConflict={vi.fn()}
    />,
  );
  await events.click(screen.getByRole('button', { name: 'Restore' }));
  return events;
}

describe('RestoreDialog', () => {
  it('names the target in its confirmation, with its own weight distinct from takedown', async () => {
    await openDialog('Jane Doe Photography');

    expect(screen.getByText(/Jane Doe Photography/)).toBeInTheDocument();
    expect(screen.getByText(/does not reopen the report/)).toBeInTheDocument();
  });

  it('requires the notice text before it will submit', async () => {
    const events = await openDialog();

    await events.click(screen.getByRole('button', { name: 'Restore content' }));

    expect(await screen.findByText('This value is too short.')).toBeInTheDocument();
    expect(postMock).not.toHaveBeenCalled();
  });

  it('posts the resolution text and calls onRestored on success', async () => {
    postMock.mockResolvedValueOnce({ data: { id: 'report-1', status: 'resolved' } });
    const onRestored = vi.fn();
    const RestoreDialog = await loadRestoreDialog();
    const events = userEvent.setup();
    render(
      <RestoreDialog
        reportId="report-1"
        targetLabel="Jane Doe Photography"
        onRestored={onRestored}
        onConflict={vi.fn()}
      />,
    );
    await events.click(screen.getByRole('button', { name: 'Restore' }));
    await events.type(
      screen.getByLabelText(/Statement of reasons/),
      'This was taken down in error.',
    );
    await events.click(screen.getByRole('button', { name: 'Restore content' }));

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledWith('/v1/admin/reports/{id}/restore', {
        params: { path: { id: 'report-1' } },
        body: { resolution: 'This was taken down in error.' },
      });
    });
    await waitFor(() => {
      expect(onRestored).toHaveBeenCalled();
    });
  });

  it('treats a 409 as an expected race, not an error toast', async () => {
    postMock.mockResolvedValueOnce({ error: { code: 'CONFLICT' } });
    const onConflict = vi.fn();
    const RestoreDialog = await loadRestoreDialog();
    const events = userEvent.setup();
    render(
      <RestoreDialog
        reportId="report-1"
        targetLabel="Jane Doe Photography"
        onRestored={vi.fn()}
        onConflict={onConflict}
      />,
    );
    await events.click(screen.getByRole('button', { name: 'Restore' }));
    await events.type(screen.getByLabelText(/Statement of reasons/), 'Reversing.');
    await events.click(screen.getByRole('button', { name: 'Restore content' }));

    await waitFor(() => {
      expect(onConflict).toHaveBeenCalled();
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
