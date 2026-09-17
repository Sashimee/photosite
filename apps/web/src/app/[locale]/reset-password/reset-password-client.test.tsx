import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next-intl', async () => {
  const { mockUseTranslations } = await import('@/testing/mock-translations');
  return { useTranslations: mockUseTranslations };
});

async function loadResetPasswordClient() {
  const { ResetPasswordClient } = await import('./reset-password-client');
  return ResetPasswordClient;
}

function setHash(hash: string) {
  window.history.replaceState(null, '', `/en/reset-password${hash}`);
}

describe('ResetPasswordClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    setHash('');
  });

  it('shows an error and a link back to forgot-password when the token is missing', async () => {
    setHash('');
    vi.stubGlobal('fetch', vi.fn());
    const ResetPasswordClient = await loadResetPasswordClient();

    render(<ResetPasswordClient locale="en" />);

    expect(await screen.findByText('This reset link is invalid.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Request a new link' })).toHaveAttribute(
      'href',
      '/en/forgot-password',
    );
  });

  it('rejects a too-short password before calling the API', async () => {
    setHash('#token=abc123');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const ResetPasswordClient = await loadResetPasswordClient();
    const user = userEvent.setup();

    render(<ResetPasswordClient locale="en" />);
    await user.type(await screen.findByLabelText('New password'), 'short');
    await user.click(screen.getByRole('button', { name: 'Reset password' }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('submits the fragment token with the new password and shows success', async () => {
    setHash('#token=abc123');
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ message: 'Password updated.' }), { status: 200 }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const ResetPasswordClient = await loadResetPasswordClient();
    const user = userEvent.setup();

    render(<ResetPasswordClient locale="en" />);
    await user.type(await screen.findByLabelText('New password'), 'correct horse battery staple');
    await user.click(screen.getByRole('button', { name: 'Reset password' }));

    expect(await screen.findByText('Password updated. You can now sign in.')).toBeInTheDocument();
    const [request] = fetchMock.mock.calls[0] as [Request];
    expect((await request.json()) as unknown).toEqual({
      token: 'abc123',
      password: 'correct horse battery staple',
    });
  });
});
