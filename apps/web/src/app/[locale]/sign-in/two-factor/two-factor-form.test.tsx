import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const pushMock = vi.fn();
const refreshMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

vi.mock('next-intl', async () => {
  const { mockUseTranslations } = await import('@/testing/mock-translations');
  return { useTranslations: mockUseTranslations };
});

async function loadTwoFactorForm() {
  const { TwoFactorForm } = await import('./two-factor-form');
  return TwoFactorForm;
}

describe('TwoFactorForm', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    pushMock.mockClear();
    refreshMock.mockClear();
  });

  it('submits the authenticator code by default', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          user: {
            id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
            email: 'client@example.com',
            emailVerifiedAt: '2026-01-01T00:00:00.000Z',
            locale: 'en',
            country: 'LU',
            roles: ['client'],
            status: 'active',
            twoFactorEnabled: true,
            lastLoginAt: null,
          },
          session: { token: 'sess_ignored', expiresAt: '2026-01-01T00:00:00.000Z' },
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const TwoFactorForm = await loadTwoFactorForm();
    const user = userEvent.setup();

    render(<TwoFactorForm locale="en" />);
    await user.type(screen.getByLabelText('Authenticator code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Verify' }));

    const [request] = fetchMock.mock.calls[0] as [Request];
    expect((await request.json()) as unknown).toEqual({ code: '123456' });
    await vi.waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith('/en/account');
    });
  });

  it('switches to the backup code field and submits it instead', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ code: 'INVALID_BACKUP_CODE' }), { status: 401 }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const TwoFactorForm = await loadTwoFactorForm();
    const user = userEvent.setup();

    render(<TwoFactorForm locale="en" />);
    await user.click(screen.getByRole('button', { name: 'Use a backup code instead' }));
    expect(screen.queryByLabelText('Authenticator code')).not.toBeInTheDocument();

    await user.type(screen.getByLabelText('Backup code'), 'abcde-12345');
    await user.click(screen.getByRole('button', { name: 'Verify' }));

    const [request] = fetchMock.mock.calls[0] as [Request];
    expect((await request.json()) as unknown).toEqual({ backupCode: 'abcde-12345' });
    expect(await screen.findByText("That backup code isn't correct.")).toBeInTheDocument();
  });
});
