import { render, screen } from '@testing-library/react';
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

async function loadAutoReleaseForm() {
  return (await import('./auto-release-form')).AutoReleaseForm;
}

async function renderForm(currentDays = 14) {
  const AutoReleaseForm = await loadAutoReleaseForm();
  const events = userEvent.setup();
  render(<AutoReleaseForm currentDays={currentDays} />);
  return { events };
}

async function submitWith(days: string) {
  const { events } = await renderForm();
  const input = screen.getByLabelText('Auto-release days');
  await events.clear(input);
  await events.type(input, days);
  await events.click(screen.getByRole('button', { name: 'Save' }));
}

describe('AutoReleaseForm', () => {
  it('rejects a non-integer number of days', async () => {
    await submitWith('3.5');

    expect(patchMock).not.toHaveBeenCalled();
    expect(await screen.findByText("This value isn't valid.")).toBeInTheDocument();
  });

  it('rejects zero days', async () => {
    await submitWith('0');

    expect(patchMock).not.toHaveBeenCalled();
    expect(await screen.findByText("This value isn't valid.")).toBeInTheDocument();
  });

  it('rejects a negative number of days', async () => {
    await submitWith('-1');

    expect(patchMock).not.toHaveBeenCalled();
    expect(await screen.findByText("This value isn't valid.")).toBeInTheDocument();
  });

  it('rejects a value above the 60-day upper bound', async () => {
    await submitWith('61');

    expect(patchMock).not.toHaveBeenCalled();
    expect(await screen.findByText("This value isn't valid.")).toBeInTheDocument();
  });

  it('rejects an empty value', async () => {
    const { events } = await renderForm();
    const input = screen.getByLabelText('Auto-release days');
    await events.clear(input);
    await events.click(screen.getByRole('button', { name: 'Save' }));

    expect(patchMock).not.toHaveBeenCalled();
    expect(await screen.findByText("This value isn't valid.")).toBeInTheDocument();
  });

  it('accepts the lower boundary of 1 day', async () => {
    patchMock.mockResolvedValueOnce({ data: { autoReleaseDays: 1 } });
    await submitWith('1');

    expect(patchMock).toHaveBeenCalledWith('/v1/admin/settings', { body: { autoReleaseDays: 1 } });
    expect(refreshMock).toHaveBeenCalled();
  });

  it('accepts the upper boundary of 60 days', async () => {
    patchMock.mockResolvedValueOnce({ data: { autoReleaseDays: 60 } });
    await submitWith('60');

    expect(patchMock).toHaveBeenCalledWith('/v1/admin/settings', { body: { autoReleaseDays: 60 } });
    expect(refreshMock).toHaveBeenCalled();
  });

  it('submits the parsed value and refreshes on success', async () => {
    patchMock.mockResolvedValueOnce({ data: { autoReleaseDays: 21 } });
    await submitWith('21');

    expect(patchMock).toHaveBeenCalledWith('/v1/admin/settings', { body: { autoReleaseDays: 21 } });
    expect(refreshMock).toHaveBeenCalled();
  });

  it('surfaces an API error and does not claim success', async () => {
    patchMock.mockResolvedValueOnce({ error: { code: 'CONFLICT' } });
    await submitWith('21');

    expect(
      await screen.findByText(
        "That couldn't be completed because something changed. Please retry.",
      ),
    ).toBeInTheDocument();
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
