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

type FeatureFlagState = components['schemas']['FeatureFlagState'];

const flags: FeatureFlagState[] = [
  { key: 'maintenanceMode', enabled: false, description: 'Stale description from the API.' },
  { key: 'newSignupsPaused', enabled: true, description: 'Also stale.' },
];

async function loadFlagsForm() {
  return (await import('./flags-form')).FlagsForm;
}

describe('FlagsForm', () => {
  it('sends only the flags that changed', async () => {
    patchMock.mockResolvedValueOnce({ data: flags });
    const FlagsForm = await loadFlagsForm();
    const events = userEvent.setup();
    render(<FlagsForm flags={flags} />);

    await events.click(screen.getByRole('checkbox', { name: /Maintenance mode/ }));
    await events.click(screen.getByRole('button', { name: 'Save' }));

    expect(patchMock).toHaveBeenCalledWith('/v1/admin/settings', {
      body: {
        featureFlags: [{ key: 'maintenanceMode', enabled: true }],
      },
    });
    expect(refreshMock).toHaveBeenCalled();
  });

  it('disables the save button and does not submit when nothing changed', async () => {
    const FlagsForm = await loadFlagsForm();
    render(<FlagsForm flags={flags} />);

    const saveButton = screen.getByRole('button', { name: 'Save' });
    expect(saveButton).toBeDisabled();

    await userEvent.setup().click(saveButton);

    expect(patchMock).not.toHaveBeenCalled();
  });

  it('surfaces an API error and does not claim success', async () => {
    patchMock.mockResolvedValueOnce({ error: { code: 'CONFLICT' } });
    const FlagsForm = await loadFlagsForm();
    const events = userEvent.setup();
    render(<FlagsForm flags={flags} />);

    await events.click(screen.getByRole('checkbox', { name: /Maintenance mode/ }));
    await events.click(screen.getByRole('button', { name: 'Save' }));

    expect(
      await screen.findByText(
        "That couldn't be completed because something changed. Please retry.",
      ),
    ).toBeInTheDocument();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it('shows the flag descriptions from i18n rather than the API payload', async () => {
    const FlagsForm = await loadFlagsForm();
    render(<FlagsForm flags={flags} />);

    expect(screen.getByText('Shows a maintenance banner on the public site.')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Pauses new account sign-ups platform-wide, independent of any single country.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText('Stale description from the API.')).not.toBeInTheDocument();
    expect(screen.queryByText('Also stale.')).not.toBeInTheDocument();
  });
});
