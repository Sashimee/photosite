import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ConfirmActionButton } from './confirm-action-button';

describe('ConfirmActionButton', () => {
  it('does not call onConfirm until the dialog is confirmed', async () => {
    const onConfirm = vi.fn().mockResolvedValue(true);
    const user = userEvent.setup();

    render(
      <ConfirmActionButton
        triggerLabel="Cancel request"
        title="Cancel this request?"
        description="Photographers can't send new quotes once it's cancelled."
        confirmLabel="Yes, cancel request"
        pendingLabel="Cancelling…"
        cancelLabel="Keep request"
        onConfirm={onConfirm}
      />,
    );

    expect(onConfirm).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Cancel request' }));
    expect(await screen.findByText('Cancel this request?')).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Yes, cancel request' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('closes the dialog once onConfirm succeeds', async () => {
    const onConfirm = vi.fn().mockResolvedValue(true);
    const user = userEvent.setup();

    render(
      <ConfirmActionButton
        triggerLabel="Accept"
        title="Accept?"
        description="Description"
        confirmLabel="Yes"
        pendingLabel="Accepting…"
        cancelLabel="No"
        onConfirm={onConfirm}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Accept' }));
    await user.click(await screen.findByRole('button', { name: 'Yes' }));

    expect(screen.queryByText('Accept?')).not.toBeInTheDocument();
  });

  it('keeps the dialog open and shows the error when onConfirm fails', async () => {
    const onConfirm = vi.fn().mockResolvedValue(false);
    const user = userEvent.setup();

    render(
      <ConfirmActionButton
        triggerLabel="Accept"
        title="Accept?"
        description="Description"
        confirmLabel="Yes"
        pendingLabel="Accepting…"
        cancelLabel="No"
        error="This quote is no longer available."
        onConfirm={onConfirm}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Accept' }));
    await user.click(await screen.findByRole('button', { name: 'Yes' }));

    expect(screen.getByText('Accept?')).toBeInTheDocument();
    expect(screen.getByText('This quote is no longer available.')).toBeInTheDocument();
  });

  it('is disabled when told to be', () => {
    render(
      <ConfirmActionButton
        triggerLabel="Accept"
        title="Accept?"
        description="Description"
        confirmLabel="Yes"
        pendingLabel="Accepting…"
        cancelLabel="No"
        disabled
        onConfirm={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Accept' })).toBeDisabled();
  });

  it('does not render the trigger at all when hidden', () => {
    render(
      <ConfirmActionButton
        triggerLabel="Accept"
        title="Accept?"
        description="Description"
        confirmLabel="Yes"
        pendingLabel="Accepting…"
        cancelLabel="No"
        hidden
        onConfirm={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Accept' })).not.toBeInTheDocument();
  });

  it('shows the pending label and marks the confirm button busy while pending', async () => {
    const user = userEvent.setup();
    render(
      <ConfirmActionButton
        triggerLabel="Accept"
        title="Accept?"
        description="Description"
        confirmLabel="Yes"
        pendingLabel="Accepting…"
        cancelLabel="No"
        pending
        onConfirm={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Accept' }));
    const confirmButton = await screen.findByRole('button', { name: 'Accepting…' });
    expect(confirmButton).toHaveAttribute('aria-busy', 'true');
    expect(confirmButton).toBeDisabled();
  });

  it('calls onOpen when the dialog opens, to let the caller clear a stale error', async () => {
    const onOpen = vi.fn();
    const user = userEvent.setup();

    render(
      <ConfirmActionButton
        triggerLabel="Accept"
        title="Accept?"
        description="Description"
        confirmLabel="Yes"
        pendingLabel="Accepting…"
        cancelLabel="No"
        onOpen={onOpen}
        onConfirm={vi.fn()}
      />,
    );

    expect(onOpen).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Accept' }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('blocks closing the dialog (cancel button, Escape) while pending', async () => {
    const user = userEvent.setup();

    render(
      <ConfirmActionButton
        triggerLabel="Accept"
        title="Accept?"
        description="Description"
        confirmLabel="Yes"
        pendingLabel="Accepting…"
        cancelLabel="No"
        pending
        onConfirm={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Accept' }));
    expect(await screen.findByText('Accept?')).toBeInTheDocument();

    expect(screen.getByRole('button', { name: 'No' })).toBeDisabled();
    await user.keyboard('{Escape}');
    expect(screen.getByText('Accept?')).toBeInTheDocument();
  });
});
