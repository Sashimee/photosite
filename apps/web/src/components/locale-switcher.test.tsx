import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const pushMock = vi.fn();
const patchMock = vi.fn();
const captureMessageMock = vi.fn();
const captureExceptionMock = vi.fn();

vi.mock('next/navigation', () => ({
  usePathname: () => '/en/photographers',
  useRouter: () => ({ push: pushMock }),
}));

vi.mock('@/lib/api', () => ({
  api: { PATCH: (...args: unknown[]) => patchMock(...args) as unknown },
}));

vi.mock('@sentry/nextjs', () => ({
  captureMessage: (...args: unknown[]) => {
    captureMessageMock(...args);
  },
  captureException: (...args: unknown[]) => {
    captureExceptionMock(...args);
  },
}));

import { LocaleSwitcher } from './locale-switcher';

const localeNames = {
  en: 'English',
  fr: 'French',
  de: 'German',
  pt: 'Portuguese',
  es: 'Spanish',
};

describe('LocaleSwitcher', () => {
  it('shows the current locale name on the trigger', () => {
    render(<LocaleSwitcher currentLocale="en" label="Change language" localeNames={localeNames} />);

    expect(screen.getByRole('button', { name: 'Change language' })).toHaveTextContent('English');
  });

  it('lists every supported locale and preserves the current path when switching', async () => {
    const user = userEvent.setup();
    render(<LocaleSwitcher currentLocale="en" label="Change language" localeNames={localeNames} />);

    await user.click(screen.getByRole('button', { name: 'Change language' }));

    const frenchLink = await screen.findByRole('menuitem', { name: 'French' });
    expect(frenchLink).toHaveAttribute('href', '/fr/photographers');
  });

  describe('persisting the locale', () => {
    afterEach(() => {
      pushMock.mockReset();
      patchMock.mockReset();
      captureMessageMock.mockReset();
      captureExceptionMock.mockReset();
    });

    async function chooseFrench(signedIn: boolean) {
      const user = userEvent.setup();
      render(
        <LocaleSwitcher
          currentLocale="en"
          label="Change language"
          localeNames={localeNames}
          signedIn={signedIn}
        />,
      );
      await user.click(screen.getByRole('button', { name: 'Change language' }));
      await user.click(await screen.findByRole('menuitem', { name: 'French' }));
    }

    it('persists the locale before navigating when signed in', async () => {
      patchMock.mockResolvedValue({ data: { user: {} }, error: undefined });

      await chooseFrench(true);

      await waitFor(() => {
        expect(pushMock).toHaveBeenCalledWith('/fr/photographers');
      });
      expect(patchMock).toHaveBeenCalledWith('/v1/me/locale', { body: { locale: 'fr' } });
      expect(patchMock.mock.invocationCallOrder[0]).toBeLessThan(
        pushMock.mock.invocationCallOrder[0] ?? 0,
      );
    });

    it('still navigates and reports when the API answers with an error', async () => {
      patchMock.mockResolvedValue({ data: undefined, error: { message: 'boom' } });

      await chooseFrench(true);

      await waitFor(() => {
        expect(pushMock).toHaveBeenCalledWith('/fr/photographers');
      });
      expect(captureMessageMock).toHaveBeenCalledTimes(1);
    });

    it('still navigates and reports when the request throws', async () => {
      const failure = new Error('network down');
      patchMock.mockRejectedValue(failure);

      await chooseFrench(true);

      await waitFor(() => {
        expect(pushMock).toHaveBeenCalledWith('/fr/photographers');
      });
      expect(captureExceptionMock).toHaveBeenCalledWith(failure);
    });

    it('makes no API call when signed out', async () => {
      await chooseFrench(false);

      expect(patchMock).not.toHaveBeenCalled();
      expect(pushMock).not.toHaveBeenCalled();
    });
  });
});
