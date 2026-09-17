import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next-intl', async () => {
  const { mockUseTranslations } = await import('@/testing/mock-translations');
  return { useTranslations: mockUseTranslations };
});

async function loadForgotPasswordForm() {
  const { ForgotPasswordForm } = await import('./forgot-password-form');
  return ForgotPasswordForm;
}

describe('ForgotPasswordForm', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('rejects an invalid email before calling the API', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const ForgotPasswordForm = await loadForgotPasswordForm();
    const user = userEvent.setup();

    render(<ForgotPasswordForm />);
    await user.type(screen.getByLabelText('Email'), 'not-an-email');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows the enumeration-safe success message regardless of whether the account exists', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ message: 'If an account exists, a reset email has been sent.' }),
        {
          status: 202,
        },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const ForgotPasswordForm = await loadForgotPasswordForm();
    const user = userEvent.setup();

    render(<ForgotPasswordForm />);
    await user.type(screen.getByLabelText('Email'), 'client@example.com');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));

    expect(
      await screen.findByText('If an account exists for that email, a reset link has been sent.'),
    ).toBeInTheDocument();
  });
});
