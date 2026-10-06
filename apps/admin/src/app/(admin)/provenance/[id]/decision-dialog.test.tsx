import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next-intl', async () => {
  const { mockUseTranslations } = await import('@/testing/mock-translations');
  return { useTranslations: mockUseTranslations };
});

const postMock = vi.fn();
vi.mock('@/lib/api', () => ({ api: { POST: postMock } }));

async function loadDecisionDialog() {
  return (await import('./decision-dialog')).DecisionDialog;
}

beforeEach(() => {
  postMock.mockReset();
});

async function openDialog(onDecided = vi.fn()) {
  const DecisionDialog = await loadDecisionDialog();
  const events = userEvent.setup();
  render(<DecisionDialog checkId="check-1" onDecided={onDecided} />);
  await events.click(screen.getByRole('button', { name: 'Record decision' }));
  return events;
}

describe('DecisionDialog', () => {
  it('labels who sees each field', async () => {
    await openDialog();

    expect(screen.getByLabelText('Internal note (only admins see this)')).toBeInTheDocument();
  });

  it('sends no decisionReason when approving and hides the reason fields', async () => {
    postMock.mockResolvedValueOnce({ data: { id: 'check-1' } });
    const onDecided = vi.fn();
    const events = await openDialog(onDecided);

    expect(screen.queryByLabelText(/Reason \(/)).not.toBeInTheDocument();
    await events.type(screen.getByLabelText(/Internal note/), 'Looks fine');
    await events.click(screen.getByRole('button', { name: 'Confirm decision' }));

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledWith('/v1/admin/provenance/{id}/decision', {
        params: { path: { id: 'check-1' } },
        body: { status: 'approved', note: 'Looks fine' },
      });
    });
    await waitFor(() => {
      expect(onDecided).toHaveBeenCalled();
    });
  });

  it('blocks a rejection without a reason', async () => {
    const events = await openDialog();

    await events.selectOptions(screen.getByLabelText('Decision'), 'rejected');
    await events.type(screen.getByLabelText(/Internal note/), 'Fake');
    await events.click(screen.getByRole('button', { name: 'Confirm decision' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/Choose a reason/);
    expect(postMock).not.toHaveBeenCalled();
  });

  it('requires reason text when the reason is other', async () => {
    const events = await openDialog();

    await events.selectOptions(screen.getByLabelText('Decision'), 'flagged');
    await events.type(screen.getByLabelText(/Internal note/), 'Unsure');
    await events.selectOptions(screen.getByLabelText(/^Reason \(/), 'other');
    await events.click(screen.getByRole('button', { name: 'Confirm decision' }));

    expect(await screen.findByText(/required for "Other"/)).toBeInTheDocument();
    expect(postMock).not.toHaveBeenCalled();
  });

  it('requires the internal note', async () => {
    const events = await openDialog();

    await events.click(screen.getByRole('button', { name: 'Confirm decision' }));

    expect(await screen.findByText('This value is too short.')).toBeInTheDocument();
    expect(postMock).not.toHaveBeenCalled();
  });

  it('shows a mapped error when the API refuses', async () => {
    postMock.mockResolvedValueOnce({ error: { code: 'NOT_FOUND' } });
    const events = await openDialog();

    await events.type(screen.getByLabelText(/Internal note/), 'ok');
    await events.click(screen.getByRole('button', { name: 'Confirm decision' }));

    expect(await screen.findByText("This check couldn't be found.")).toBeInTheDocument();
  });
});
