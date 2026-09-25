import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { components } from '@photoo/api-client';

vi.mock('next-intl', async () => {
  const { mockUseTranslations } = await import('@/testing/mock-translations');
  return { useTranslations: mockUseTranslations };
});

const patchMock = vi.fn();
vi.mock('@/lib/api', () => ({ api: { PATCH: patchMock } }));

type AdminCountry = components['schemas']['AdminCountry'];

const enabledCountry: AdminCountry = {
  code: 'LU',
  name: 'Luxembourg',
  currency: 'EUR',
  enabled: true,
  vatRate: 17,
  defaultLocale: 'fr',
  accountCount: 42,
};

const disabledCountry: AdminCountry = {
  ...enabledCountry,
  code: 'BE',
  name: 'Belgium',
  enabled: false,
  accountCount: 3,
};

async function loadCountryToggleDialog() {
  return (await import('./country-toggle-dialog')).CountryToggleDialog;
}

describe('CountryToggleDialog', () => {
  it('names the country and its affected-account count, and states disabling is not deleting', async () => {
    const CountryToggleDialog = await loadCountryToggleDialog();
    const events = userEvent.setup();
    render(<CountryToggleDialog country={enabledCountry} onToggled={vi.fn()} />);

    await events.click(screen.getByRole('button', { name: 'Disable' }));

    expect(screen.getByText('Disable Luxembourg?')).toBeInTheDocument();
    expect(
      screen.getByText(
        "This stops new sign-ups, profiles and requests in Luxembourg. It does not delete or hide the 42 existing accounts already there, and it doesn't affect their bookings.",
      ),
    ).toBeInTheDocument();
  });

  it('uses the singular account wording for a single affected account', async () => {
    const CountryToggleDialog = await loadCountryToggleDialog();
    const events = userEvent.setup();
    render(
      <CountryToggleDialog country={{ ...enabledCountry, accountCount: 1 }} onToggled={vi.fn()} />,
    );

    await events.click(screen.getByRole('button', { name: 'Disable' }));

    expect(
      screen.getByText(
        "This stops new sign-ups, profiles and requests in Luxembourg. It does not delete or hide the 1 existing account already there, and it doesn't affect their bookings.",
      ),
    ).toBeInTheDocument();
  });

  it('submits the toggle and calls onToggled on success', async () => {
    patchMock.mockResolvedValueOnce({ data: { ...enabledCountry, enabled: false } });
    const onToggled = vi.fn();
    const CountryToggleDialog = await loadCountryToggleDialog();
    const events = userEvent.setup();
    render(<CountryToggleDialog country={enabledCountry} onToggled={onToggled} />);

    await events.click(screen.getByRole('button', { name: 'Disable' }));
    await events.click(screen.getByRole('button', { name: 'Disable country' }));

    expect(patchMock).toHaveBeenCalledWith('/v1/admin/countries/{code}', {
      params: { path: { code: 'LU' } },
      body: { enabled: false },
    });
    expect(onToggled).toHaveBeenCalled();
  });

  it('uses the plural account wording for zero affected accounts', async () => {
    const CountryToggleDialog = await loadCountryToggleDialog();
    const events = userEvent.setup();
    render(
      <CountryToggleDialog country={{ ...enabledCountry, accountCount: 0 }} onToggled={vi.fn()} />,
    );

    await events.click(screen.getByRole('button', { name: 'Disable' }));

    expect(
      screen.getByText(
        "This stops new sign-ups, profiles and requests in Luxembourg. It does not delete or hide the 0 existing accounts already there, and it doesn't affect their bookings.",
      ),
    ).toBeInTheDocument();
  });

  it('surfaces an API error and does not call onToggled', async () => {
    patchMock.mockResolvedValueOnce({ error: { code: 'CONFLICT' } });
    const onToggled = vi.fn();
    const CountryToggleDialog = await loadCountryToggleDialog();
    const events = userEvent.setup();
    render(<CountryToggleDialog country={enabledCountry} onToggled={onToggled} />);

    await events.click(screen.getByRole('button', { name: 'Disable' }));
    await events.click(screen.getByRole('button', { name: 'Disable country' }));

    expect(
      await screen.findByText(
        "That couldn't be completed because something changed. Please retry.",
      ),
    ).toBeInTheDocument();
    expect(onToggled).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('offers to re-enable a disabled country without naming a deletion consequence', async () => {
    const CountryToggleDialog = await loadCountryToggleDialog();
    const events = userEvent.setup();
    render(<CountryToggleDialog country={disabledCountry} onToggled={vi.fn()} />);

    await events.click(screen.getByRole('button', { name: 'Enable' }));

    expect(screen.getByText('Enable Belgium?')).toBeInTheDocument();
    expect(
      screen.getByText(
        'This lets new sign-ups, profiles and requests in Belgium start again, and affects the 3 existing accounts already there.',
      ),
    ).toBeInTheDocument();
  });

  it('uses the singular account wording when re-enabling a country with one existing account', async () => {
    const CountryToggleDialog = await loadCountryToggleDialog();
    const events = userEvent.setup();
    render(
      <CountryToggleDialog country={{ ...disabledCountry, accountCount: 1 }} onToggled={vi.fn()} />,
    );

    await events.click(screen.getByRole('button', { name: 'Enable' }));

    expect(
      screen.getByText(
        'This lets new sign-ups, profiles and requests in Belgium start again, and affects the 1 existing account already there.',
      ),
    ).toBeInTheDocument();
  });
});
