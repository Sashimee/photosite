import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next-intl', async () => {
  const { mockUseTranslations } = await import('@/testing/mock-translations');
  return { useTranslations: mockUseTranslations };
});

const refreshMock = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: refreshMock }) }));

const patchMock = vi.fn();
vi.mock('@/lib/api', () => ({ api: { PATCH: patchMock } }));

async function loadFeeDialog() {
  return (await import('./fee-dialog')).FeeDialog;
}

async function openDialog(currentFeePercent: number | null = 5) {
  const FeeDialog = await loadFeeDialog();
  const events = userEvent.setup();
  render(<FeeDialog currentFeePercent={currentFeePercent} />);
  await events.click(screen.getByRole('button', { name: 'Change fee' }));
  const dialog = within(screen.getByRole('dialog'));
  return { events, dialog };
}

describe('FeeDialog', () => {
  it('does not submit without the typed confirmation', async () => {
    const { events, dialog } = await openDialog();

    await events.type(dialog.getByLabelText('New fee (%)'), '7');
    await events.click(dialog.getByRole('button', { name: 'Change fee' }));

    expect(patchMock).not.toHaveBeenCalled();
    expect(await dialog.findByText("Doesn't match the new fee above.")).toBeInTheDocument();
  });

  it('names the old and new value in the confirmation label and the blast-radius text', async () => {
    const { events, dialog } = await openDialog(5);

    await events.type(dialog.getByLabelText('New fee (%)'), '7');

    expect(dialog.getByLabelText('Type 7 to confirm')).toBeInTheDocument();
    expect(
      dialog.getByText(
        'This changes the marketplace fee from 5% to 7%. Bookings already quoted keep the fee they were quoted at; only quotes created after this change use the new fee.',
      ),
    ).toBeInTheDocument();
  });

  it('shows the fee as not configured when there is no current fee', async () => {
    const { events, dialog } = await openDialog(null);

    await events.type(dialog.getByLabelText('New fee (%)'), '7');

    expect(
      dialog.getByText(
        'This changes the marketplace fee from Not configured to 7%. Bookings already quoted keep the fee they were quoted at; only quotes created after this change use the new fee.',
      ),
    ).toBeInTheDocument();
  });

  it('rejects values with more than two decimal places', async () => {
    const { events, dialog } = await openDialog();

    await events.type(dialog.getByLabelText('New fee (%)'), '5.123');
    await events.click(dialog.getByRole('button', { name: 'Change fee' }));

    expect(patchMock).not.toHaveBeenCalled();
    expect(await dialog.findByText("This value isn't valid.")).toBeInTheDocument();
  });

  it('matches the typed confirmation numerically even with different decimal formatting', async () => {
    patchMock.mockResolvedValueOnce({ data: { feePercent: 5 } });
    const { events, dialog } = await openDialog(3);

    await events.type(dialog.getByLabelText('New fee (%)'), '5');
    await events.type(dialog.getByLabelText('Type 5 to confirm'), '5.00');
    await events.click(dialog.getByRole('button', { name: 'Change fee' }));

    expect(patchMock).toHaveBeenCalledWith('/v1/admin/settings', { body: { feePercent: 5 } });
    expect(refreshMock).toHaveBeenCalled();
  });

  it('submits once the typed confirmation matches the new value', async () => {
    patchMock.mockResolvedValueOnce({ data: { feePercent: 7 } });
    const { events, dialog } = await openDialog();

    await events.type(dialog.getByLabelText('New fee (%)'), '7');
    await events.type(dialog.getByLabelText('Type 7 to confirm'), '7');
    await events.click(dialog.getByRole('button', { name: 'Change fee' }));

    expect(patchMock).toHaveBeenCalledWith('/v1/admin/settings', { body: { feePercent: 7 } });
    expect(refreshMock).toHaveBeenCalled();
  });

  it('resets the confirmation field when the new fee value changes', async () => {
    const { events, dialog } = await openDialog();

    await events.type(dialog.getByLabelText('New fee (%)'), '7');
    await events.type(dialog.getByLabelText('Type 7 to confirm'), '7');
    await events.type(dialog.getByLabelText('New fee (%)'), '5');
    await events.click(dialog.getByRole('button', { name: 'Change fee' }));

    expect(patchMock).not.toHaveBeenCalled();
  });

  it('surfaces an API error and does not claim success', async () => {
    patchMock.mockResolvedValueOnce({ error: { code: 'CONFLICT' } });
    const { events, dialog } = await openDialog();

    await events.type(dialog.getByLabelText('New fee (%)'), '7');
    await events.type(dialog.getByLabelText('Type 7 to confirm'), '7');
    await events.click(dialog.getByRole('button', { name: 'Change fee' }));

    expect(
      await dialog.findByText(
        "That couldn't be completed because something changed. Please retry.",
      ),
    ).toBeInTheDocument();
    expect(refreshMock).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('does not render an error message for a TWO_FACTOR_REQUIRED response', async () => {
    patchMock.mockResolvedValueOnce({ error: { code: 'TWO_FACTOR_REQUIRED' } });
    const { events, dialog } = await openDialog();

    await events.type(dialog.getByLabelText('New fee (%)'), '7');
    await events.type(dialog.getByLabelText('Type 7 to confirm'), '7');
    await events.click(dialog.getByRole('button', { name: 'Change fee' }));

    expect(patchMock).toHaveBeenCalled();
    expect(refreshMock).not.toHaveBeenCalled();
    expect(dialog.queryByText('Something went wrong. Please try again.')).not.toBeInTheDocument();
  });

  it('accepts a leading-dot decimal value', async () => {
    patchMock.mockResolvedValueOnce({ data: { feePercent: 0.5 } });
    const { events, dialog } = await openDialog();

    await events.type(dialog.getByLabelText('New fee (%)'), '.5');
    await events.type(dialog.getByLabelText('Type 0.5 to confirm'), '.5');
    await events.click(dialog.getByRole('button', { name: 'Change fee' }));

    expect(patchMock).toHaveBeenCalledWith('/v1/admin/settings', { body: { feePercent: 0.5 } });
    expect(refreshMock).toHaveBeenCalled();
  });

  it('blocks submitting a fee equal to the current fee', async () => {
    const { events, dialog } = await openDialog(5);

    await events.type(dialog.getByLabelText('New fee (%)'), '5');

    expect(dialog.getByRole('button', { name: 'Change fee' })).toBeDisabled();
    expect(dialog.getByText("That's already the current fee.")).toBeInTheDocument();
    expect(patchMock).not.toHaveBeenCalled();
  });

  it('clears the fields when reopened after a successful submit', async () => {
    patchMock.mockResolvedValueOnce({ data: { feePercent: 7 } });
    const { events, dialog } = await openDialog();

    await events.type(dialog.getByLabelText('New fee (%)'), '7');
    await events.type(dialog.getByLabelText('Type 7 to confirm'), '7');
    await events.click(dialog.getByRole('button', { name: 'Change fee' }));

    expect(refreshMock).toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await events.click(screen.getByRole('button', { name: 'Change fee' }));
    const reopened = within(screen.getByRole('dialog'));

    expect(reopened.getByLabelText('New fee (%)')).toHaveValue(null);
    expect(reopened.queryByLabelText(/to confirm$/)).not.toBeInTheDocument();
  });
});
