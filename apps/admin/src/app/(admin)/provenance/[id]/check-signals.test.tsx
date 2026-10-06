import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next-intl/server', async () => {
  const { mockUseFormatter, translate } = await import('@/testing/mock-translations');
  return {
    getTranslations: (namespace: string) => (key: string, values?: Record<string, unknown>) =>
      translate(namespace, key, values),
    getFormatter: () => Promise.resolve(mockUseFormatter()),
  };
});
vi.mock('next-intl', async () => {
  const { mockUseTranslations } = await import('@/testing/mock-translations');
  return { useTranslations: mockUseTranslations };
});

async function loadCheckSignals() {
  return (await import('./check-signals')).CheckSignals;
}

const base = {
  id: 'check-1',
  portfolioImageId: 'image-1',
  portfolioImageStatus: 'pending_review' as const,
  thumbnailUrl: 'https://media.example.com/1.jpg',
  photographer: { id: 'p1', displayName: 'Jane', slug: 'jane' },
  verdict: 'review' as const,
  score: null,
  checkedAt: null,
  reviewedAt: null,
  aiScore: null,
  aiVendor: null,
  reverseMatches: null,
  c2paValid: null,
  exifCamera: null,
  exifCapturedAt: null,
  reviewedByAdminId: null,
  note: null,
  decisionReason: null,
  decisionReasonText: null,
};

describe('CheckSignals', () => {
  it('renders the not-checked state for missing vendor signals instead of zero or blank', async () => {
    const CheckSignals = await loadCheckSignals();

    render(await CheckSignals({ check: base }));

    expect(screen.getAllByText('Not checked (no vendor configured)')).toHaveLength(4);
    expect(screen.queryByText('0%')).not.toBeInTheDocument();
  });

  it('renders a present score as a percentage', async () => {
    const CheckSignals = await loadCheckSignals();

    render(await CheckSignals({ check: { ...base, aiScore: 0.87, aiVendor: 'acme' } }));

    expect(screen.getByText('87%')).toBeInTheDocument();
    expect(screen.getByText('acme')).toBeInTheDocument();
  });

  it('renders reverse matches as copyable text, never as links', async () => {
    const CheckSignals = await loadCheckSignals();

    render(
      await CheckSignals({
        check: { ...base, reverseMatches: ['https://evil.example.com/photo'] },
      }),
    );

    expect(screen.getByText('https://evil.example.com/photo')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('says no matches were found for an empty list', async () => {
    const CheckSignals = await loadCheckSignals();

    render(await CheckSignals({ check: { ...base, reverseMatches: [] } }));

    expect(screen.getByText('No matches found.')).toBeInTheDocument();
  });
});
