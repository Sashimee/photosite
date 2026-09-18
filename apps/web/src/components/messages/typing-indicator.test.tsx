import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { translate } from '@/testing/mock-translations';

vi.mock('next-intl', async () => {
  const { mockUseTranslations } = await import('@/testing/mock-translations');
  return { useTranslations: mockUseTranslations };
});

async function loadIndicator() {
  const { TypingIndicator } = await import('./typing-indicator');
  return TypingIndicator;
}

describe('TypingIndicator', () => {
  it('renders nothing when nobody is typing', async () => {
    const TypingIndicator = await loadIndicator();
    const { container } = render(<TypingIndicator name={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the other participant name while typing', async () => {
    const TypingIndicator = await loadIndicator();
    render(<TypingIndicator name="Jane Doe" />);
    expect(
      screen.getByText(translate('web.messages.thread', 'typingIndicator', { name: 'Jane Doe' })),
    ).toBeInTheDocument();
  });
});
