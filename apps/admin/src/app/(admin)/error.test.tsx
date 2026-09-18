import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next-intl', async () => {
  const { mockUseTranslations } = await import('@/testing/mock-translations');
  return { useTranslations: mockUseTranslations };
});

async function loadAdminError() {
  const mod = await import('./error');
  return mod.default;
}

describe('AdminError', () => {
  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('renders a fixed, mapped message instead of the raw error payload', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const rawPayload = JSON.stringify({
      code: 'INTERNAL_ERROR',
      message: 'db connection string leaked',
    });
    const AdminError = await loadAdminError();

    render(<AdminError error={new Error(rawPayload)} reset={vi.fn()} />);

    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByText('An unexpected error occurred. Please try again.')).toBeInTheDocument();
    expect(screen.queryByText(rawPayload, { exact: false })).not.toBeInTheDocument();
    expect(screen.queryByText(/db connection string leaked/)).not.toBeInTheDocument();
  });

  it('calls reset when retry is clicked', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const reset = vi.fn();
    const AdminError = await loadAdminError();
    const user = userEvent.setup();

    render(<AdminError error={new Error('boom')} reset={reset} />);
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(reset).toHaveBeenCalledTimes(1);
  });
});
