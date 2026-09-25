import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next-intl', async () => {
  const { mockUseTranslations } = await import('@/testing/mock-translations');
  return { useTranslations: mockUseTranslations };
});

const postMock = vi.fn();
vi.mock('@/lib/api', () => ({ api: { POST: postMock } }));

import type { TakedownTarget } from './takedown-dialog';

async function loadTakedownDialog() {
  return (await import('./takedown-dialog')).TakedownDialog;
}

const reportTarget: TakedownTarget = { kind: 'report', reportId: 'report-1' };
const directTarget: TakedownTarget = {
  kind: 'direct',
  targetType: 'photographer_profile',
  targetId: 'profile-1',
};

async function openDialog(target: TakedownTarget, targetLabel = 'Jane Doe Photography') {
  const TakedownDialog = await loadTakedownDialog();
  const events = userEvent.setup();
  render(
    <TakedownDialog
      target={target}
      targetLabel={targetLabel}
      onDecided={vi.fn()}
      onConflict={vi.fn()}
    />,
  );
  await events.click(screen.getByRole('button', { name: 'Take down' }));
  return events;
}

describe('TakedownDialog', () => {
  it('names the target in its confirmation', async () => {
    await openDialog(reportTarget, 'Jane Doe Photography');

    expect(screen.getByText(/Jane Doe Photography/)).toBeInTheDocument();
  });

  it('labels the notice field as sent to both the reporter and the owner', async () => {
    await openDialog(reportTarget);

    expect(
      screen.getByLabelText('Statement of reasons (sent to the reporter and the content owner)'),
    ).toBeInTheDocument();
  });

  it('requires the notice text before it will submit', async () => {
    const events = await openDialog(reportTarget);

    await events.click(screen.getByRole('button', { name: 'Take down content' }));

    expect(await screen.findByText('This value is too short.')).toBeInTheDocument();
    expect(postMock).not.toHaveBeenCalled();
  });

  it('posts the resolution text to the report endpoint and calls onDecided on success', async () => {
    postMock.mockResolvedValueOnce({ data: { id: 'report-1', status: 'resolved' } });
    const onDecided = vi.fn();
    const TakedownDialog = await loadTakedownDialog();
    const events = userEvent.setup();
    render(
      <TakedownDialog
        target={reportTarget}
        targetLabel="Jane Doe Photography"
        onDecided={onDecided}
        onConflict={vi.fn()}
      />,
    );
    await events.click(screen.getByRole('button', { name: 'Take down' }));
    await events.type(
      screen.getByLabelText(/Statement of reasons/),
      'Removed for violating the content policy.',
    );
    await events.click(screen.getByRole('button', { name: 'Take down content' }));

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledWith('/v1/admin/reports/{id}/takedown', {
        params: { path: { id: 'report-1' } },
        body: { resolution: 'Removed for violating the content policy.' },
      });
    });
    await waitFor(() => {
      expect(onDecided).toHaveBeenCalledWith({ id: 'report-1', status: 'resolved' });
    });
  });

  it('treats a 409 as an expected race, not an error toast', async () => {
    postMock.mockResolvedValueOnce({ error: { code: 'CONFLICT' } });
    const onConflict = vi.fn();
    const TakedownDialog = await loadTakedownDialog();
    const events = userEvent.setup();
    render(
      <TakedownDialog
        target={reportTarget}
        targetLabel="Jane Doe Photography"
        onDecided={vi.fn()}
        onConflict={onConflict}
      />,
    );
    await events.click(screen.getByRole('button', { name: 'Take down' }));
    await events.type(screen.getByLabelText(/Statement of reasons/), 'Removed.');
    await events.click(screen.getByRole('button', { name: 'Take down content' }));

    await waitFor(() => {
      expect(onConflict).toHaveBeenCalled();
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('posts a direct takedown to the report-free endpoint with the given target', async () => {
    postMock.mockResolvedValueOnce({
      data: { id: 'report-9', status: 'resolved', reporterId: null },
    });
    const onDecided = vi.fn();
    const TakedownDialog = await loadTakedownDialog();
    const events = userEvent.setup();
    render(
      <TakedownDialog
        target={directTarget}
        targetLabel="Jane Doe Photography"
        onDecided={onDecided}
      />,
    );
    await events.click(screen.getByRole('button', { name: 'Take down' }));
    await events.type(screen.getByLabelText(/Statement of reasons/), 'Found by a moderator.');
    await events.click(screen.getByRole('button', { name: 'Take down content' }));

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledWith('/v1/admin/reports/direct-takedown', {
        body: {
          targetType: 'photographer_profile',
          targetId: 'profile-1',
          resolution: 'Found by a moderator.',
        },
      });
    });
    await waitFor(() => {
      expect(onDecided).toHaveBeenCalledWith({
        id: 'report-9',
        status: 'resolved',
        reporterId: null,
      });
    });
  });

  it('shows a generic error for a direct takedown without a conflict handler', async () => {
    postMock.mockResolvedValueOnce({ error: { code: 'NOT_FOUND' } });
    const TakedownDialog = await loadTakedownDialog();
    const events = userEvent.setup();
    render(
      <TakedownDialog
        target={directTarget}
        targetLabel="Jane Doe Photography"
        onDecided={vi.fn()}
      />,
    );
    await events.click(screen.getByRole('button', { name: 'Take down' }));
    await events.type(screen.getByLabelText(/Statement of reasons/), 'Found by a moderator.');
    await events.click(screen.getByRole('button', { name: 'Take down content' }));

    expect(await screen.findByText("This couldn't be found.")).toBeInTheDocument();
  });
});
