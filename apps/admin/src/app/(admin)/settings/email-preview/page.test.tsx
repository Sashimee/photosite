import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const serverApiMock = vi.fn();

vi.mock('@/lib/server-api', () => ({ serverApi: serverApiMock }));
vi.mock('next-intl/server', async () => {
  const { translate } = await import('@/testing/mock-translations');
  return {
    getTranslations: (namespace: string) => (key: string, values?: Record<string, unknown>) =>
      translate(namespace, key, values),
  };
});

vi.mock('./email-preview-panel', () => ({
  EmailPreviewPanel: () => <div data-testid="email-preview-panel" />,
}));

async function loadPage() {
  const mod = await import('./page');
  return mod.default;
}

describe('EmailPreviewPage', () => {
  it('renders the template panel when templates load', async () => {
    serverApiMock.mockResolvedValue({
      GET: vi.fn().mockResolvedValueOnce({
        data: ['verify-email', 'reset-password'],
        response: { status: 200 },
      }),
    });
    const EmailPreviewPage = await loadPage();

    render(await EmailPreviewPage());

    expect(screen.getByTestId('email-preview-panel')).toBeInTheDocument();
    expect(screen.getByText('Email templates')).toBeInTheDocument();
  });

  it('renders a forbidden message instead of throwing on a 403', async () => {
    serverApiMock.mockResolvedValue({
      GET: vi.fn().mockResolvedValueOnce({ data: undefined, response: { status: 403 } }),
    });
    const EmailPreviewPage = await loadPage();

    render(await EmailPreviewPage());

    expect(screen.getByText("You don't have permission to do this.")).toBeInTheDocument();
    expect(screen.queryByTestId('email-preview-panel')).not.toBeInTheDocument();
  });

  it('throws on an unexpected load failure instead of silently rendering an empty picker', async () => {
    serverApiMock.mockResolvedValue({
      GET: vi.fn().mockResolvedValueOnce({ data: undefined, response: { status: 500 } }),
    });
    const EmailPreviewPage = await loadPage();

    await expect(EmailPreviewPage()).rejects.toThrow(/HTTP 500/);
  });
});
