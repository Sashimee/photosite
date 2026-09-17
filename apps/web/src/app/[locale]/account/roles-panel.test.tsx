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

async function loadRolesPanel() {
  const { RolesPanel } = await import('./roles-panel');
  return RolesPanel;
}

describe('RolesPanel', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    refreshMock.mockClear();
  });

  it('lists current roles and offers only the missing ones to add', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const RolesPanel = await loadRolesPanel();

    render(<RolesPanel roles={['client']} />);

    expect(screen.getByText('Client looking to book a photographer')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Photographer' })).toBeInTheDocument();
    expect(
      screen.queryByRole('option', { name: 'Client looking to book a photographer' }),
    ).not.toBeInTheDocument();
  });

  it('shows the placeholder message once every role is already held', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const RolesPanel = await loadRolesPanel();

    render(<RolesPanel roles={['client', 'photographer', 'professional']} />);

    expect(screen.getByText('You already have every role.')).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('adds the selected role and refreshes the session', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          user: {
            id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
            email: 'client@example.com',
            emailVerifiedAt: '2026-01-01T00:00:00.000Z',
            locale: 'en',
            country: 'LU',
            roles: ['client', 'photographer'],
            status: 'active',
            twoFactorEnabled: false,
            lastLoginAt: null,
          },
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const RolesPanel = await loadRolesPanel();
    const user = userEvent.setup();

    render(<RolesPanel roles={['client']} />);
    await user.selectOptions(screen.getByRole('combobox'), 'photographer');
    await user.click(screen.getByRole('button', { name: 'Add role' }));

    expect(await screen.findByText('Role added.')).toBeInTheDocument();
    expect(screen.getByText('Photographer')).toBeInTheDocument();
    expect(refreshMock).toHaveBeenCalled();

    const [request] = fetchMock.mock.calls[0] as [Request];
    expect((await request.json()) as unknown).toEqual({ role: 'photographer' });
  });

  it('shows a translated error when adding a role fails', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ code: 'ROLE_ALREADY_ASSIGNED' }), { status: 409 }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const RolesPanel = await loadRolesPanel();
    const user = userEvent.setup();

    render(<RolesPanel roles={['client']} />);
    await user.click(screen.getByRole('button', { name: 'Add role' }));

    expect(await screen.findByText('You already have this role.')).toBeInTheDocument();
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
