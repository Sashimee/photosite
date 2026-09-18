import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { translate } from '@/testing/mock-translations';

vi.mock('next-intl', async () => {
  const { mockUseTranslations } = await import('@/testing/mock-translations');
  return { useTranslations: mockUseTranslations };
});

async function loadStatus() {
  const { ConnectionStatus } = await import('./connection-status');
  return ConnectionStatus;
}

describe('ConnectionStatus', () => {
  it.each(['connecting', 'connected'] as const)('renders nothing while %s', async (state) => {
    const ConnectionStatus = await loadStatus();
    const { container } = render(<ConnectionStatus state={state} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows a reconnecting notice once disconnected', async () => {
    const ConnectionStatus = await loadStatus();
    render(<ConnectionStatus state="disconnected" />);
    expect(screen.getByText(translate('web.messages.thread', 'reconnecting'))).toBeInTheDocument();
  });
});
