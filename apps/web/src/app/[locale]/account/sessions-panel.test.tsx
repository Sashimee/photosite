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

async function loadSessionsPanel() {
  const { SessionsPanel } = await import('./sessions-panel');
  return SessionsPanel;
}

describe('SessionsPanel', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    pushMock.mockClear();
    refreshMock.mockClear();
  });

  it('signs out of the current session and redirects to sign-in', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    const SessionsPanel = await loadSessionsPanel();
    const user = userEvent.setup();

    render(<SessionsPanel locale="en" />);
    await user.click(screen.getByRole('button', { name: 'Sign out' }));

    await vi.waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith('/en/sign-in');
    });
    expect(refreshMock).toHaveBeenCalled();
    const [request] = fetchMock.mock.calls[0] as [Request];
    expect(request.url).toContain('/v1/auth/sign-out');
  });

  it('signs out of every device', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    const SessionsPanel = await loadSessionsPanel();
    const user = userEvent.setup();

    render(<SessionsPanel locale="en" />);
    await user.click(screen.getByRole('button', { name: 'Sign out everywhere' }));

    await vi.waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith('/en/sign-in');
    });
    const [request] = fetchMock.mock.calls[0] as [Request];
    expect(request.url).toContain('/v1/auth/sessions/revoke-all');
  });

  it('shows a translated error when sign-out fails', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ code: 'UNAUTHORIZED' }), { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);
    const SessionsPanel = await loadSessionsPanel();
    const user = userEvent.setup();

    render(<SessionsPanel locale="en" />);
    await user.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(await screen.findByText('Please sign in to continue.')).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });
});
