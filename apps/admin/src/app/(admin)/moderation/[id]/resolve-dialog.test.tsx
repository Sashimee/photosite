import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next-intl', async () => {
  const { mockUseTranslations } = await import('@/testing/mock-translations');
  return { useTranslations: mockUseTranslations };
});

const postMock = vi.fn();
vi.mock('@/lib/api', () => ({ api: { POST: postMock } }));

async function loadResolveDialog() {
  return (await import('./resolve-dialog')).ResolveDialog;
}

describe('ResolveDialog', () => {
  it('labels the notice field as sent to both the reporter and the owner', async () => {
    const ResolveDialog = await loadResolveDialog();
    const events = userEvent.setup();
    render(
      <ResolveDialog
        reportId="report-1"
        status="resolved"
        onDecided={vi.fn()}
        onConflict={vi.fn()}
      />,
    );
    await events.click(screen.getByRole('button', { name: 'Resolve' }));

    expect(
      screen.getByLabelText('Statement of reasons (sent to the reporter and the content owner)'),
    ).toBeInTheDocument();
  });

  it('requires the notice text before it will submit', async () => {
    const ResolveDialog = await loadResolveDialog();
    const events = userEvent.setup();
    render(
      <ResolveDialog
        reportId="report-1"
        status="dismissed"
        onDecided={vi.fn()}
        onConflict={vi.fn()}
      />,
    );
    await events.click(screen.getByRole('button', { name: 'Dismiss' }));
    await events.click(screen.getByRole('button', { name: 'Dismiss report' }));

    expect(await screen.findByText('This value is too short.')).toBeInTheDocument();
    expect(postMock).not.toHaveBeenCalled();
  });

  it('posts the chosen status and resolution text', async () => {
    postMock.mockResolvedValueOnce({ data: { id: 'report-1', status: 'resolved' } });
    const onDecided = vi.fn();
    const ResolveDialog = await loadResolveDialog();
    const events = userEvent.setup();
    render(
      <ResolveDialog
        reportId="report-1"
        status="resolved"
        onDecided={onDecided}
        onConflict={vi.fn()}
      />,
    );
    await events.click(screen.getByRole('button', { name: 'Resolve' }));
    await events.type(
      screen.getByLabelText(/Statement of reasons/),
      'Reviewed - content complies with our policy.',
    );
    await events.click(screen.getByRole('button', { name: 'Resolve report' }));

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledWith('/v1/admin/reports/{id}/resolve', {
        params: { path: { id: 'report-1' } },
        body: { status: 'resolved', resolution: 'Reviewed - content complies with our policy.' },
      });
    });
    await waitFor(() => {
      expect(onDecided).toHaveBeenCalled();
    });
  });

  it('treats a 409 as an expected race, not an error toast', async () => {
    postMock.mockResolvedValueOnce({ error: { code: 'CONFLICT' } });
    const onConflict = vi.fn();
    const ResolveDialog = await loadResolveDialog();
    const events = userEvent.setup();
    render(
      <ResolveDialog
        reportId="report-1"
        status="resolved"
        onDecided={vi.fn()}
        onConflict={onConflict}
      />,
    );
    await events.click(screen.getByRole('button', { name: 'Resolve' }));
    await events.type(screen.getByLabelText(/Statement of reasons/), 'Reviewed.');
    await events.click(screen.getByRole('button', { name: 'Resolve report' }));

    await waitFor(() => {
      expect(onConflict).toHaveBeenCalled();
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('routes a stale second factor to re-verification instead of showing a toast', async () => {
    postMock.mockResolvedValueOnce({ error: { code: 'TWO_FACTOR_REQUIRED' } });
    const onDecided = vi.fn();
    const ResolveDialog = await loadResolveDialog();
    const events = userEvent.setup();
    render(
      <ResolveDialog
        reportId="report-1"
        status="resolved"
        onDecided={onDecided}
        onConflict={vi.fn()}
      />,
    );
    await events.click(screen.getByRole('button', { name: 'Resolve' }));
    await events.type(screen.getByLabelText(/Statement of reasons/), 'Reviewed.');
    await events.click(screen.getByRole('button', { name: 'Resolve report' }));

    await waitFor(() => {
      expect(postMock).toHaveBeenCalled();
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(onDecided).not.toHaveBeenCalled();
  });
});
