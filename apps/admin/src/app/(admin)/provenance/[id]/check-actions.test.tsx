import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next-intl', async () => {
  const { mockUseTranslations } = await import('@/testing/mock-translations');
  return { useTranslations: mockUseTranslations };
});

const refreshMock = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: refreshMock }) }));

const postMock = vi.fn();
vi.mock('@/lib/api', () => ({ api: { POST: postMock } }));

async function loadCheckActions() {
  return (await import('./check-actions')).CheckActions;
}

beforeEach(() => {
  postMock.mockReset();
  refreshMock.mockReset();
});

describe('CheckActions', () => {
  it('says a recheck is already running on 409', async () => {
    postMock.mockResolvedValueOnce({ error: { code: 'CONFLICT' } });
    const CheckActions = await loadCheckActions();
    const events = userEvent.setup();

    render(<CheckActions checkId="check-1" />);
    await events.click(screen.getByRole('button', { name: 'Recheck' }));

    expect(
      await screen.findByText('A recheck is already running for this image.'),
    ).toBeInTheDocument();
    expect(postMock).toHaveBeenCalledWith('/v1/admin/provenance/{id}/recheck', {
      params: { path: { id: 'check-1' } },
    });
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it('refreshes the page after a started recheck', async () => {
    postMock.mockResolvedValueOnce({ data: { id: 'check-1' } });
    const CheckActions = await loadCheckActions();
    const events = userEvent.setup();

    render(<CheckActions checkId="check-1" />);
    await events.click(screen.getByRole('button', { name: 'Recheck' }));

    expect(await screen.findByText(/Recheck started/)).toBeInTheDocument();
    expect(refreshMock).toHaveBeenCalled();
  });

  it('disables recheck while the request is in flight', async () => {
    let resolve: (value: unknown) => void = () => undefined;
    postMock.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    const CheckActions = await loadCheckActions();
    const events = userEvent.setup();

    render(<CheckActions checkId="check-1" />);
    await events.click(screen.getByRole('button', { name: 'Recheck' }));

    expect(screen.getByRole('button', { name: 'Rechecking...' })).toBeDisabled();
    resolve({ data: {} });
    expect(await screen.findByRole('button', { name: 'Recheck' })).toBeEnabled();
  });
});
