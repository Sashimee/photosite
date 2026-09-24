import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next-intl', async () => {
  const { mockUseTranslations } = await import('@/testing/mock-translations');
  return { useTranslations: mockUseTranslations };
});

const getMock = vi.fn();
vi.mock('@/lib/api', () => ({ api: { GET: getMock } }));

async function loadModerationTable() {
  return (await import('./moderation-table')).ModerationTable;
}

const baseReport = {
  id: 'report-1',
  reporterId: 'user-1',
  targetType: 'photographer_profile' as const,
  targetId: 'profile-1',
  reason: 'This profile is impersonating someone else.',
  status: 'open' as const,
  adminId: null,
  resolution: null,
  createdAt: '2026-09-20T12:00:00.000Z',
  resolvedAt: null,
  target: {
    targetType: 'photographer_profile' as const,
    displayName: 'Jane Doe',
    slug: 'jane-doe',
    isPublished: true,
    deletedAt: null,
  },
};

describe('ModerationTable', () => {
  it('requests the queue with the default open status, relying on the API for oldest-first order', async () => {
    getMock.mockResolvedValueOnce({ data: { items: [baseReport], nextCursor: null } });
    const ModerationTable = await loadModerationTable();

    render(<ModerationTable status="open" />);
    await screen.findByText(baseReport.reason);

    expect(getMock).toHaveBeenCalledWith('/v1/admin/reports', {
      params: { query: { status: 'open' } },
    });
  });

  it('forwards the target-type filter and cursor on every page', async () => {
    getMock.mockResolvedValueOnce({ data: { items: [baseReport], nextCursor: null } });
    const ModerationTable = await loadModerationTable();

    render(<ModerationTable status="resolved" targetType="photographer_profile" />);
    await screen.findByText(baseReport.reason);

    expect(getMock).toHaveBeenCalledWith('/v1/admin/reports', {
      params: { query: { status: 'resolved', targetType: 'photographer_profile' } },
    });
  });

  it('renders the reason as plain link text, never as HTML', async () => {
    const htmlLookingReport = {
      ...baseReport,
      reason: '<img src=x onerror=alert(1)>',
    };
    getMock.mockResolvedValueOnce({ data: { items: [htmlLookingReport], nextCursor: null } });
    const ModerationTable = await loadModerationTable();

    render(<ModerationTable status="open" />);

    const link = await screen.findByRole('link', { name: '<img src=x onerror=alert(1)>' });
    expect(link).toBeInTheDocument();
    expect(document.querySelector('img[src="x"]')).not.toBeInTheDocument();
  });

  it('shows a present reporter as present and an anonymous one as anonymous', async () => {
    getMock.mockResolvedValueOnce({
      data: {
        items: [baseReport, { ...baseReport, id: 'report-2', reporterId: null }],
        nextCursor: null,
      },
    });
    const ModerationTable = await loadModerationTable();

    render(<ModerationTable status="open" />);

    expect(await screen.findByText('Reporter present')).toBeInTheDocument();
    expect(screen.getByText('Anonymous')).toBeInTheDocument();
  });

  it("shows a report's age in whole days", async () => {
    const fourDaysAgo = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString();
    getMock.mockResolvedValueOnce({
      data: { items: [{ ...baseReport, createdAt: fourDaysAgo }], nextCursor: null },
    });
    const ModerationTable = await loadModerationTable();

    render(<ModerationTable status="open" />);

    expect(await screen.findByText('4 days ago')).toBeInTheDocument();
  });
});
