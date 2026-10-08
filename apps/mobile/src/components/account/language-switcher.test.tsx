import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

const mockUpdateUser = jest.fn();
const mockAuth = { current: {} as Record<string, unknown> };
jest.mock('../../lib/auth-context', () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => children,
  useAuth: () => mockAuth.current,
}));

jest.mock('../../lib/api', () => ({
  api: { PATCH: jest.fn() },
  setUnauthorizedListener: jest.fn(),
}));

import i18n from '../../lib/i18n';
import { api } from '../../lib/api';
import { LanguageSwitcher } from './language-switcher';

const user = { email: 'a@example.com', roles: ['client'], locale: 'en' };

function reply(status: number, body?: unknown) {
  return {
    data: status < 300 ? body : undefined,
    error: status < 300 ? undefined : body,
    response: new Response(null, { status }),
  } as never;
}

beforeEach(async () => {
  mockUpdateUser.mockReset();
  jest.mocked(api.PATCH).mockReset();
  mockAuth.current = { status: 'signed-in', user, updateUser: mockUpdateUser };
  await i18n.changeLanguage('en');
});

afterEach(async () => {
  await i18n.changeLanguage('en');
});

describe('LanguageSwitcher', () => {
  it('persists the locale, updates the user and switches the language', async () => {
    const updated = { ...user, locale: 'fr' };
    jest.mocked(api.PATCH).mockResolvedValue(reply(200, { user: updated }));
    render(<LanguageSwitcher />);

    fireEvent.press(screen.getByTestId('account-locale-fr'));

    await waitFor(() => {
      expect(i18n.language).toBe('fr');
    });
    expect(api.PATCH).toHaveBeenCalledWith('/v1/me/locale', { body: { locale: 'fr' } });
    expect(mockUpdateUser).toHaveBeenCalledWith(updated);
  });

  it('compares against the saved locale, so the device locale can be saved', async () => {
    const savedUser = { ...user, locale: 'de' };
    mockAuth.current = { status: 'signed-in', user: savedUser, updateUser: mockUpdateUser };
    jest.mocked(api.PATCH).mockResolvedValue(reply(200, { user: { ...user, locale: 'en' } }));
    render(<LanguageSwitcher />);

    expect(screen.getByTestId('account-locale-de')).toBeChecked();
    fireEvent.press(screen.getByTestId('account-locale-en'));

    await waitFor(() => {
      expect(api.PATCH).toHaveBeenCalledWith('/v1/me/locale', { body: { locale: 'en' } });
    });
  });

  it('keeps the previous language and shows an error when the API rejects', async () => {
    jest.mocked(api.PATCH).mockResolvedValue(reply(500, { code: 'INTERNAL' }));
    render(<LanguageSwitcher />);

    fireEvent.press(screen.getByTestId('account-locale-fr'));

    await screen.findByText("We couldn't save your language. Check your connection and try again.");
    expect(i18n.language).toBe('en');
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  it('keeps the previous language and shows an error when the request throws', async () => {
    jest.mocked(api.PATCH).mockRejectedValue(new Error('offline'));
    render(<LanguageSwitcher />);

    fireEvent.press(screen.getByTestId('account-locale-de'));

    await screen.findByTestId('account-language-error');
    expect(i18n.language).toBe('en');
  });

  it('only switches i18next when signed out', async () => {
    mockAuth.current = { status: 'signed-out', user: null, updateUser: mockUpdateUser };
    render(<LanguageSwitcher />);

    fireEvent.press(screen.getByTestId('account-locale-de'));

    await waitFor(() => {
      expect(i18n.language).toBe('de');
    });
    expect(api.PATCH).not.toHaveBeenCalled();
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  it('disables the control and ignores taps while the request is pending', async () => {
    let resolve: (value: never) => void = () => undefined;
    jest.mocked(api.PATCH).mockReturnValue(
      new Promise<never>((r) => {
        resolve = r;
      }),
    );
    render(<LanguageSwitcher />);

    fireEvent.press(screen.getByTestId('account-locale-fr'));

    await waitFor(() => {
      expect(screen.getByTestId('account-locale-de')).toBeDisabled();
    });
    fireEvent.press(screen.getByTestId('account-locale-de'));
    expect(api.PATCH).toHaveBeenCalledTimes(1);

    await act(() => {
      resolve(reply(200, { user }));
      return Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.getByTestId('account-locale-de')).not.toBeDisabled();
    });
  });
});
