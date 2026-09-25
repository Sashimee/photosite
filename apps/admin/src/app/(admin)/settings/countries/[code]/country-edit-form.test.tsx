import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { components } from '@photoo/api-client';

vi.mock('next-intl', async () => {
  const { mockUseTranslations } = await import('@/testing/mock-translations');
  return { useTranslations: mockUseTranslations };
});

const refreshMock = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: refreshMock }) }));

const patchMock = vi.fn();
vi.mock('@/lib/api', () => ({ api: { PATCH: patchMock } }));

type AdminCountry = components['schemas']['AdminCountry'];

const country: AdminCountry = {
  code: 'LU',
  name: 'Luxembourg',
  currency: 'EUR',
  enabled: true,
  vatRate: 17,
  defaultLocale: 'fr',
  accountCount: 42,
};

async function loadCountryEditForm() {
  return (await import('./country-edit-form')).CountryEditForm;
}

async function renderForm(overrides: Partial<AdminCountry> = {}) {
  const CountryEditForm = await loadCountryEditForm();
  const events = userEvent.setup();
  render(<CountryEditForm country={{ ...country, ...overrides }} />);
  return { events };
}

async function submitWithVatRate(value: string) {
  const { events } = await renderForm();
  const input = screen.getByLabelText('VAT rate (%)');
  await events.clear(input);
  if (value !== '') {
    await events.type(input, value);
  }
  await events.click(screen.getByRole('button', { name: 'Save' }));
  return { events };
}

describe('CountryEditForm', () => {
  it('rejects an empty VAT rate', async () => {
    await submitWithVatRate('');

    expect(patchMock).not.toHaveBeenCalled();
    expect(await screen.findByText("This value isn't valid.")).toBeInTheDocument();
  });

  it('rejects a negative VAT rate', async () => {
    await submitWithVatRate('-1');

    expect(patchMock).not.toHaveBeenCalled();
    expect(await screen.findByText("This value isn't valid.")).toBeInTheDocument();
  });

  it('rejects a VAT rate above the 100 upper bound', async () => {
    await submitWithVatRate('101');

    expect(patchMock).not.toHaveBeenCalled();
    expect(await screen.findByText("This value isn't valid.")).toBeInTheDocument();
  });

  it('accepts the lower boundary of 0', async () => {
    patchMock.mockResolvedValueOnce({ data: { ...country, vatRate: 0 } });
    await submitWithVatRate('0');

    expect(patchMock).toHaveBeenCalledWith('/v1/admin/countries/{code}', {
      params: { path: { code: 'LU' } },
      body: { vatRate: 0, defaultLocale: 'fr' },
    });
    expect(refreshMock).toHaveBeenCalled();
  });

  it('accepts the upper boundary of 100', async () => {
    patchMock.mockResolvedValueOnce({ data: { ...country, vatRate: 100 } });
    await submitWithVatRate('100');

    expect(patchMock).toHaveBeenCalledWith('/v1/admin/countries/{code}', {
      params: { path: { code: 'LU' } },
      body: { vatRate: 100, defaultLocale: 'fr' },
    });
    expect(refreshMock).toHaveBeenCalled();
  });

  it('accepts a fractional VAT rate', async () => {
    patchMock.mockResolvedValueOnce({ data: { ...country, vatRate: 17.5 } });
    await submitWithVatRate('17.5');

    expect(patchMock).toHaveBeenCalledWith('/v1/admin/countries/{code}', {
      params: { path: { code: 'LU' } },
      body: { vatRate: 17.5, defaultLocale: 'fr' },
    });
    expect(refreshMock).toHaveBeenCalled();
  });

  it('submits the selected default locale', async () => {
    patchMock.mockResolvedValueOnce({ data: { ...country, defaultLocale: 'de' } });
    const { events } = await renderForm();

    await events.selectOptions(screen.getByLabelText('Default locale'), 'de');
    await events.click(screen.getByRole('button', { name: 'Save' }));

    expect(patchMock).toHaveBeenCalledWith('/v1/admin/countries/{code}', {
      params: { path: { code: 'LU' } },
      body: { vatRate: 17, defaultLocale: 'de' },
    });
    expect(refreshMock).toHaveBeenCalled();
  });

  it('surfaces an API error and does not claim success', async () => {
    patchMock.mockResolvedValueOnce({ error: { code: 'CONFLICT' } });
    await submitWithVatRate('20');

    expect(
      await screen.findByText(
        "That couldn't be completed because something changed. Please retry.",
      ),
    ).toBeInTheDocument();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it('does not render an error message for a TWO_FACTOR_REQUIRED response', async () => {
    patchMock.mockResolvedValueOnce({ error: { code: 'TWO_FACTOR_REQUIRED' } });
    await submitWithVatRate('20');

    expect(patchMock).toHaveBeenCalled();
    expect(refreshMock).not.toHaveBeenCalled();
    expect(screen.queryByText('Something went wrong. Please try again.')).not.toBeInTheDocument();
  });
});
