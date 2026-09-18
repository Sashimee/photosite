import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const pushMock = vi.fn();
const refreshMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

async function loadSignOutButton() {
  const { SignOutButton } = await import('./sign-out-button');
  return SignOutButton;
}

describe('SignOutButton', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    pushMock.mockClear();
    refreshMock.mockClear();
  });

  it('signs out and returns to sign-in', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    const SignOutButton = await loadSignOutButton();
    const user = userEvent.setup();

    render(<SignOutButton label="Sign out" />);
    await user.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(pushMock).toHaveBeenCalledWith('/sign-in');
    expect(refreshMock).toHaveBeenCalled();
  });
});
