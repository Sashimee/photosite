import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next-intl', async () => {
  const { mockUseTranslations } = await import('@/testing/mock-translations');
  return { useTranslations: mockUseTranslations };
});

async function loadCopyText() {
  return (await import('./copy-text')).CopyText;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('CopyText', () => {
  it('shows the value as text and copies exactly that value', async () => {
    const CopyText = await loadCopyText();
    const events = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();

    render(<CopyText value="https://evil.example.com/a?b=1" />);
    expect(screen.getByText('https://evil.example.com/a?b=1')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    await events.click(screen.getByRole('button', { name: 'Copy' }));

    expect(writeText).toHaveBeenCalledExactlyOnceWith('https://evil.example.com/a?b=1');
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });

  it('does not claim success when the clipboard write fails', async () => {
    const CopyText = await loadCopyText();
    const events = userEvent.setup();
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'));
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);

    render(<CopyText value="https://x.example.com" />);
    await events.click(screen.getByRole('button', { name: 'Copy' }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    process.off('unhandledRejection', unhandled);

    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Copied' })).not.toBeInTheDocument();
  });
});
