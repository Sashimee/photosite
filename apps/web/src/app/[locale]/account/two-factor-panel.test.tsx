import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const refreshMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

vi.mock('next-intl', async () => {
  const { mockUseTranslations } = await import('@/testing/mock-translations');
  return { useTranslations: mockUseTranslations };
});

async function loadTwoFactorPanel() {
  const { TwoFactorPanel } = await import('./two-factor-panel');
  return TwoFactorPanel;
}

const enrollResponse = {
  secret: 'JBSWY3DPEHPK3PXP',
  otpauthUrl: 'otpauth://totp/photoo.lu:client@example.com?secret=JBSWY3DPEHPK3PXP',
  backupCodes: ['abcde-11111', 'fghij-22222'],
};

describe('TwoFactorPanel', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    refreshMock.mockClear();
  });

  it('shows the disabled state and enable button when 2FA is off', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const TwoFactorPanel = await loadTwoFactorPanel();

    render(<TwoFactorPanel twoFactorEnabled={false} />);

    expect(screen.getByText('Two-factor authentication is off.')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Enable two-factor authentication' }),
    ).toBeInTheDocument();
  });

  it('shows the enabled state and disable button when 2FA is on', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const TwoFactorPanel = await loadTwoFactorPanel();

    render(<TwoFactorPanel twoFactorEnabled />);

    expect(screen.getByText('Two-factor authentication is on.')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Disable two-factor authentication' }),
    ).toBeInTheDocument();
  });

  it('walks through the full enrollment flow', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(enrollResponse), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const TwoFactorPanel = await loadTwoFactorPanel();
    const user = userEvent.setup();

    render(<TwoFactorPanel twoFactorEnabled={false} />);

    await user.click(screen.getByRole('button', { name: 'Enable two-factor authentication' }));
    await user.type(screen.getByLabelText('Current password'), 'correct horse battery staple');
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(await screen.findByText('JBSWY3DPEHPK3PXP')).toBeInTheDocument();
    expect(screen.getByText('abcde-11111')).toBeInTheDocument();

    const verifyButton = screen.getByRole('button', { name: 'Enable two-factor authentication' });
    expect(verifyButton).toBeDisabled();

    await user.click(screen.getByRole('checkbox', { name: "I've saved my backup codes" }));
    expect(verifyButton).toBeEnabled();

    await user.type(screen.getByLabelText('6-digit code from your authenticator app'), '123456');
    await user.click(verifyButton);

    expect(
      await screen.findByText('Two-factor authentication is now enabled.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Two-factor authentication is on.')).toBeInTheDocument();
    expect(refreshMock).toHaveBeenCalled();

    const calls = fetchMock.mock.calls as [Request][];
    const [secondRequest] = calls[1] ?? [];
    expect(((await secondRequest?.json()) as { code: string }).code).toBe('123456');
  });

  it('disables 2FA with the current code and password', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const TwoFactorPanel = await loadTwoFactorPanel();
    const user = userEvent.setup();

    render(<TwoFactorPanel twoFactorEnabled />);
    await user.click(screen.getByRole('button', { name: 'Disable two-factor authentication' }));
    await user.type(screen.getByLabelText('Current authenticator code'), '654321');
    await user.type(screen.getByLabelText('Current password'), 'correct horse battery staple');
    await user.click(screen.getByRole('button', { name: 'Disable two-factor authentication' }));

    expect(
      await screen.findByText('Two-factor authentication is now disabled.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Two-factor authentication is off.')).toBeInTheDocument();
    expect(refreshMock).toHaveBeenCalled();
  });

  it('shows a translated error when enrollment fails', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ code: 'INVALID_PASSWORD' }), { status: 400 }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const TwoFactorPanel = await loadTwoFactorPanel();
    const user = userEvent.setup();

    render(<TwoFactorPanel twoFactorEnabled={false} />);
    await user.click(screen.getByRole('button', { name: 'Enable two-factor authentication' }));
    await user.type(screen.getByLabelText('Current password'), 'wrong-password');
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(await screen.findByText('Incorrect email or password.')).toBeInTheDocument();
  });
});
