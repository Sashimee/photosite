import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next-intl', async () => {
  const { mockUseTranslations } = await import('@/testing/mock-translations');
  return { useTranslations: mockUseTranslations };
});

async function loadSignUpForm() {
  const { SignUpForm } = await import('./sign-up-form');
  return SignUpForm;
}

describe('SignUpForm', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('shows validation errors and blocks submission for an incomplete form', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const SignUpForm = await loadSignUpForm();
    const user = userEvent.setup();

    render(<SignUpForm locale="en" />);
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findAllByRole('alert')).not.toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('submits the chosen role and shows the success notice', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          user: {
            id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
            email: 'client@example.com',
            emailVerifiedAt: null,
            locale: 'en',
            country: 'LU',
            roles: ['photographer'],
            status: 'active',
            twoFactorEnabled: false,
            lastLoginAt: null,
          },
        }),
        { status: 201 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const SignUpForm = await loadSignUpForm();
    const user = userEvent.setup();

    render(<SignUpForm locale="en" />);
    await user.type(screen.getByLabelText('Email'), 'client@example.com');
    await user.type(screen.getByLabelText('Password'), 'correct horse battery staple');
    await user.click(screen.getByRole('radio', { name: 'Photographer' }));
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(
      await screen.findByText('Check your email to verify your account before signing in.'),
    ).toBeInTheDocument();

    const [request] = fetchMock.mock.calls[0] as [Request];
    const body = (await request.json()) as { roles: string[] };
    expect(body.roles).toEqual(['photographer']);
  });

  it('maps a known API error code to a translated message', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ code: 'USER_ALREADY_EXISTS' }), { status: 409 }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const SignUpForm = await loadSignUpForm();
    const user = userEvent.setup();

    render(<SignUpForm locale="en" />);
    await user.type(screen.getByLabelText('Email'), 'client@example.com');
    await user.type(screen.getByLabelText('Password'), 'correct horse battery staple');
    await user.click(screen.getByRole('radio', { name: 'Client looking to book a photographer' }));
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(
      await screen.findByText('An account with this email already exists.'),
    ).toBeInTheDocument();
  });
});
