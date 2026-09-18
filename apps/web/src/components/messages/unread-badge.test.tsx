import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SERVER_SOCKET_EVENTS } from '@photoo/shared';

const getMock = vi.fn();
vi.mock('@/lib/api', () => ({ api: { GET: getMock } }));

class FakeSocket {
  private listeners = new Map<string, Set<() => void>>();
  on(event: string, callback: () => void) {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(callback);
  }
  off(event: string, callback: () => void) {
    this.listeners.get(event)?.delete(callback);
  }
  trigger(event: string) {
    for (const callback of [...(this.listeners.get(event) ?? [])]) callback();
  }
}

let sharedSocket: FakeSocket | null = null;
vi.mock('@/lib/chat-socket', () => ({
  useSharedChatSocket: () => sharedSocket,
}));

async function loadBadge() {
  const { UnreadMessagesBadge } = await import('./unread-badge');
  return UnreadMessagesBadge;
}

describe('UnreadMessagesBadge', () => {
  afterEach(() => {
    vi.resetModules();
    getMock.mockReset();
    sharedSocket = null;
  });

  it('renders nothing while the count is zero', async () => {
    getMock.mockResolvedValue({ data: { count: 0 } });
    const UnreadMessagesBadge = await loadBadge();

    const { container } = render(<UnreadMessagesBadge />);

    await waitFor(() => {
      expect(getMock).toHaveBeenCalled();
    });
    expect(container).toBeEmptyDOMElement();
  });

  it('reads the unread count once on mount', async () => {
    getMock.mockResolvedValue({ data: { count: 3 } });
    const UnreadMessagesBadge = await loadBadge();

    render(<UnreadMessagesBadge />);

    expect(await screen.findByText('3')).toBeInTheDocument();
    expect(getMock).toHaveBeenCalledWith('/v1/conversations/unread-count');
  });

  it('caps the visible count at 9+', async () => {
    getMock.mockResolvedValue({ data: { count: 12 } });
    const UnreadMessagesBadge = await loadBadge();

    render(<UnreadMessagesBadge />);

    expect(await screen.findByText('9+')).toBeInTheDocument();
  });

  it('refreshes when a socket exists and conversation:updated arrives', async () => {
    sharedSocket = new FakeSocket();
    getMock
      .mockResolvedValueOnce({ data: { count: 1 } })
      .mockResolvedValueOnce({ data: { count: 4 } });
    const UnreadMessagesBadge = await loadBadge();

    render(<UnreadMessagesBadge />);
    expect(await screen.findByText('1')).toBeInTheDocument();

    sharedSocket.trigger(SERVER_SOCKET_EVENTS.CONVERSATION_UPDATED);

    expect(await screen.findByText('4')).toBeInTheDocument();
  });

  it('never refreshes from the socket when none exists', async () => {
    getMock.mockResolvedValue({ data: { count: 1 } });
    const UnreadMessagesBadge = await loadBadge();

    render(<UnreadMessagesBadge />);
    expect(await screen.findByText('1')).toBeInTheDocument();
    expect(getMock).toHaveBeenCalledTimes(1);
  });
});
