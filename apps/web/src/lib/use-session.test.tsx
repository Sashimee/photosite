import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SessionUser } from './session';

const sampleUser: SessionUser = {
  id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  email: 'client@example.com',
  emailVerifiedAt: null,
  locale: 'en',
  country: 'LU',
  roles: ['client'],
  status: 'active',
  twoFactorEnabled: false,
  lastLoginAt: null,
};

async function loadProbe() {
  const { useSession } = await import('./use-session');

  function Probe({ initialUser }: { initialUser: SessionUser | null }) {
    const { user, status, refresh } = useSession(initialUser);
    return (
      <div>
        <p data-testid="status">{status}</p>
        <p data-testid="email">{user?.email ?? 'none'}</p>
        <button
          onClick={() => {
            void refresh();
          }}
        >
          refresh
        </button>
      </div>
    );
  }

  return Probe;
}

describe('useSession', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('hydrates from the initial user without fetching', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const Probe = await loadProbe();

    render(<Probe initialUser={sampleUser} />);

    expect(screen.getByTestId('status')).toHaveTextContent('authenticated');
    expect(screen.getByTestId('email')).toHaveTextContent('client@example.com');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fetches the session when there is no initial user', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ user: sampleUser }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const Probe = await loadProbe();

    render(<Probe initialUser={null} />);

    expect(await screen.findByTestId('status')).toHaveTextContent('authenticated');
    expect(screen.getByTestId('email')).toHaveTextContent('client@example.com');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reports unauthenticated when the session lookup fails', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ code: 'UNAUTHORIZED' }), { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);
    const Probe = await loadProbe();

    render(<Probe initialUser={null} />);

    expect(await screen.findByTestId('status')).toHaveTextContent('unauthenticated');
    expect(screen.getByTestId('email')).toHaveTextContent('none');
  });

  it('refreshes on demand', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ code: 'UNAUTHORIZED' }), { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);
    const Probe = await loadProbe();
    const user = userEvent.setup();

    render(<Probe initialUser={sampleUser} />);
    expect(screen.getByTestId('status')).toHaveTextContent('authenticated');

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'refresh' }));
    });

    expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated');
    expect(screen.getByTestId('email')).toHaveTextContent('none');
  });
});
