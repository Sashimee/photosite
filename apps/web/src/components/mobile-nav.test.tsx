import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const pushMock = vi.fn();
const patchMock = vi.fn();

vi.mock('next/navigation', () => ({
  usePathname: () => '/en',
  useRouter: () => ({ push: pushMock }),
}));

vi.mock('@/lib/api', () => ({
  api: { PATCH: (...args: unknown[]) => patchMock(...args) as unknown },
}));

import { MobileNav } from './mobile-nav';

const localeNames = {
  en: 'English',
  fr: 'French',
  de: 'German',
  pt: 'Portuguese',
  es: 'Spanish',
};

const links = [
  { href: '/en/photographers', label: 'Find a photographer' },
  { href: '/en/for-photographers', label: 'For photographers' },
];

describe('MobileNav', () => {
  const authLink = { href: '/en/sign-in', label: 'Sign in' };

  it('is closed by default', () => {
    render(
      <MobileNav
        locale="en"
        links={links}
        authLink={authLink}
        openLabel="Open menu"
        closeLabel="Close menu"
        menuTitle="Navigation"
        switcherLabel="Change language"
        localeNames={localeNames}
      />,
    );

    expect(screen.queryByRole('link', { name: 'Find a photographer' })).not.toBeInTheDocument();
  });

  it('opens the sheet and shows every nav link and sign-in', async () => {
    const user = userEvent.setup();
    render(
      <MobileNav
        locale="en"
        links={links}
        authLink={authLink}
        openLabel="Open menu"
        closeLabel="Close menu"
        menuTitle="Navigation"
        switcherLabel="Change language"
        localeNames={localeNames}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Open menu' }));

    expect(await screen.findByRole('link', { name: 'Find a photographer' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'For photographers' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('shows the account link instead of sign-in when a user is provided', async () => {
    const user = userEvent.setup();
    render(
      <MobileNav
        locale="en"
        links={links}
        authLink={{ href: '/en/account', label: 'Account' }}
        openLabel="Open menu"
        closeLabel="Close menu"
        menuTitle="Navigation"
        switcherLabel="Change language"
        localeNames={localeNames}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Open menu' }));

    expect(await screen.findByRole('link', { name: 'Account' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Sign in' })).not.toBeInTheDocument();
  });

  describe('locale persistence', () => {
    afterEach(() => {
      pushMock.mockReset();
      patchMock.mockReset();
    });

    async function chooseFrench(signedIn: boolean) {
      const user = userEvent.setup();
      render(
        <MobileNav
          locale="en"
          links={links}
          authLink={authLink}
          openLabel="Open menu"
          closeLabel="Close menu"
          menuTitle="Navigation"
          switcherLabel="Change language"
          localeNames={localeNames}
          signedIn={signedIn}
        />,
      );
      await user.click(screen.getByRole('button', { name: 'Open menu' }));
      await user.click(await screen.findByRole('button', { name: 'Change language' }));
      await user.click(await screen.findByRole('menuitem', { name: 'French' }));
    }

    it('persists the locale from the sheet when signed in', async () => {
      patchMock.mockResolvedValue({ data: { user: {} }, error: undefined });

      await chooseFrench(true);

      await waitFor(() => {
        expect(pushMock).toHaveBeenCalledWith('/fr');
      });
      expect(patchMock).toHaveBeenCalledWith('/v1/me/locale', { body: { locale: 'fr' } });
    });

    it('makes no API call from the sheet when signed out', async () => {
      await chooseFrench(false);

      expect(patchMock).not.toHaveBeenCalled();
    });
  });
});
