import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { translate } from '@/testing/mock-translations';

const refreshMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));
vi.mock('next-intl', async () => {
  const { mockUseTranslations } = await import('@/testing/mock-translations');
  return { useTranslations: mockUseTranslations };
});

const EXISTING_PROFILE = {
  id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  companyName: 'Acme Studios',
  website: 'https://acme.example',
  logoUrl: 'https://cdn.example/logo.png',
  verified: false,
  vatNumber: 'LU12345678',
};

async function loadProfessionalProfileForm() {
  const { ProfessionalProfileForm } = await import('./professional-profile-form');
  return ProfessionalProfileForm;
}

function fillMinimalCreateForm() {
  fireEvent.change(screen.getByLabelText('Company name'), { target: { value: 'Acme Studios' } });
}

describe('ProfessionalProfileForm', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    refreshMock.mockReset();
  });

  it('blocks submission and maps a client-side zod issue onto the website field, never reaching the network', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const ProfessionalProfileForm = await loadProfessionalProfileForm();
    const user = userEvent.setup({ delay: null });

    render(<ProfessionalProfileForm existing={null} email="jane@example.com" />);
    fillMinimalCreateForm();
    fireEvent.change(screen.getByLabelText('Website'), { target: { value: 'not-a-url' } });
    await user.click(screen.getByRole('button', { name: 'Create profile' }));

    expect(
      await screen.findByText('Enter a valid value.', {
        selector: '#professional-website-error',
      }),
    ).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('creates a profile with trimmed fields and no logo change', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(EXISTING_PROFILE), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    const ProfessionalProfileForm = await loadProfessionalProfileForm();
    const user = userEvent.setup({ delay: null });

    render(<ProfessionalProfileForm existing={null} email="jane@example.com" />);
    fireEvent.change(screen.getByLabelText('Company name'), {
      target: { value: '  Acme Studios  ' },
    });
    fireEvent.change(screen.getByLabelText('VAT number'), { target: { value: '  LU1  ' } });
    await user.click(screen.getByRole('button', { name: 'Create profile' }));

    expect(await screen.findByText('Profile created.')).toBeInTheDocument();
    expect(refreshMock).toHaveBeenCalled();

    const [request] = fetchMock.mock.calls[0] as [Request];
    expect(request.method).toBe('POST');
    const body = (await request.json()) as {
      companyName: string;
      website: string | null;
      vatNumber: string | null;
      logoUploadId?: unknown;
    };
    expect(body).toEqual({ companyName: 'Acme Studios', website: null, vatNumber: 'LU1' });
    expect('logoUploadId' in body).toBe(false);
  });

  it('edits an existing profile with PATCH, pre-filled from the profile', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(EXISTING_PROFILE), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const ProfessionalProfileForm = await loadProfessionalProfileForm();
    const user = userEvent.setup({ delay: null });

    render(<ProfessionalProfileForm existing={EXISTING_PROFILE} email="jane@example.com" />);

    expect(screen.getByDisplayValue('Acme Studios')).toBeInTheDocument();
    expect(screen.getByDisplayValue('https://acme.example')).toBeInTheDocument();
    expect(screen.getByDisplayValue('LU12345678')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText('Saved.')).toBeInTheDocument();
    const [request] = fetchMock.mock.calls[0] as [Request];
    expect(request.method).toBe('PATCH');
    const body = (await request.json()) as Record<string, unknown>;
    expect('logoUploadId' in body).toBe(false);
  });

  it('maps a 409 on create to "you already have a profile"', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ code: 'CONFLICT' }), { status: 409 }));
    vi.stubGlobal('fetch', fetchMock);
    const ProfessionalProfileForm = await loadProfessionalProfileForm();
    const user = userEvent.setup({ delay: null });

    render(<ProfessionalProfileForm existing={null} email="jane@example.com" />);
    fillMinimalCreateForm();
    await user.click(screen.getByRole('button', { name: 'Create profile' }));

    expect(
      await screen.findByText(translate('web.professional', 'errors.alreadyExists')),
    ).toBeInTheDocument();
  });

  it('maps a 409 on update to a logo-conflict message, distinct from create', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ code: 'CONFLICT' }), { status: 409 }));
    vi.stubGlobal('fetch', fetchMock);
    const ProfessionalProfileForm = await loadProfessionalProfileForm();
    const user = userEvent.setup({ delay: null });

    render(<ProfessionalProfileForm existing={EXISTING_PROFILE} email="jane@example.com" />);
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(
      await screen.findByText(translate('web.professional', 'errors.logoConflict')),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(translate('web.professional', 'errors.alreadyExists')),
    ).not.toBeInTheDocument();
  });

  it('maps a 429 with a retry hint to the translated message', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ code: 'TOO_MANY_REQUESTS', details: { retryAfterSeconds: 12 } }),
        {
          status: 429,
        },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const ProfessionalProfileForm = await loadProfessionalProfileForm();
    const user = userEvent.setup({ delay: null });

    render(<ProfessionalProfileForm existing={null} email="jane@example.com" />);
    fillMinimalCreateForm();
    await user.click(screen.getByRole('button', { name: 'Create profile' }));

    expect(
      await screen.findByText(
        translate('web.professional', 'errors.tooManyRequestsWithRetry', { seconds: 12 }),
      ),
    ).toBeInTheDocument();
  });

  it('shows the shared email-verification prompt on EMAIL_NOT_VERIFIED without losing entered values', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ code: 'EMAIL_NOT_VERIFIED' }), { status: 403 }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const ProfessionalProfileForm = await loadProfessionalProfileForm();
    const user = userEvent.setup({ delay: null });

    render(<ProfessionalProfileForm existing={null} email="jane@example.com" />);
    fillMinimalCreateForm();
    await user.click(screen.getByRole('button', { name: 'Create profile' }));

    expect(
      await screen.findByRole('button', { name: 'Resend verification email' }),
    ).toBeInTheDocument();
    expect(screen.getByDisplayValue('Acme Studios')).toBeInTheDocument();
  });
});
