import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next-intl', async () => {
  const { mockUseTranslations } = await import('@/testing/mock-translations');
  return { useTranslations: mockUseTranslations };
});

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function loadReadinessTable() {
  vi.resetModules();
  const { ReadinessTable } = await import('./readiness-table');
  return ReadinessTable;
}

describe('ReadinessTable', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders both checks as OK when the API is ready', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ status: 'ok', checks: { database: 'ok', redis: 'ok' } }, 200),
        ),
    );
    const ReadinessTable = await loadReadinessTable();

    render(<ReadinessTable />);

    expect(await screen.findByText('Database')).toBeInTheDocument();
    expect(screen.getByText('Redis')).toBeInTheDocument();
    expect(screen.getAllByText('OK')).toHaveLength(2);
  });

  it('shows which dependency is down from a 503, rather than a blanket error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(
          {
            code: 'SERVICE_UNAVAILABLE',
            message: 'A dependency is unreachable',
            requestId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
            details: { database: 'down', redis: 'ok' },
          },
          503,
        ),
      ),
    );
    const ReadinessTable = await loadReadinessTable();

    render(<ReadinessTable />);

    expect(await screen.findByText('Down')).toBeInTheDocument();
    expect(screen.getByText('OK')).toBeInTheDocument();
  });

  it('falls back to the generic error state when there are no per-check details', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(
          {
            code: 'INTERNAL',
            message: 'boom',
            requestId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
          },
          500,
        ),
      ),
    );
    const ReadinessTable = await loadReadinessTable();

    render(<ReadinessTable />);

    expect(await screen.findByRole('alert')).toHaveTextContent('An error occurred');
  });
});
