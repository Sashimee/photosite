import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next-intl', async () => {
  const { mockUseFormatter, mockUseTranslations } = await import('@/testing/mock-translations');
  return { useTranslations: mockUseTranslations, useFormatter: mockUseFormatter };
});

const getMock = vi.fn();
const postMock = vi.fn();
vi.mock('@/lib/api', () => ({ api: { GET: getMock, POST: postMock } }));

async function loadProvenanceTable() {
  return (await import('./provenance-table')).ProvenanceTable;
}

function summary(id: string, displayName: string, score: number | null = 0.42) {
  return {
    id,
    portfolioImageId: `image-${id}`,
    portfolioImageStatus: 'pending_review' as const,
    thumbnailUrl: `https://media.example.com/${id}.jpg`,
    photographer: { id: `p-${id}`, displayName, slug: displayName.toLowerCase() },
    verdict: 'review' as const,
    score,
    checkedAt: '2026-09-20T12:00:00.000Z',
    reviewedAt: null,
  };
}

beforeEach(() => {
  getMock.mockReset();
  postMock.mockReset();
});

describe('ProvenanceTable', () => {
  it('requests the queue with pending_review by default and relies on the API for oldest-first', async () => {
    getMock.mockResolvedValueOnce({ data: { items: [summary('c1', 'Jane')], nextCursor: null } });
    const ProvenanceTable = await loadProvenanceTable();

    render(<ProvenanceTable status="pending_review" />);
    await screen.findByText('Jane');

    expect(getMock).toHaveBeenCalledWith('/v1/admin/provenance', {
      params: { query: { status: 'pending_review' } },
    });
  });

  it('forwards the verdict filter', async () => {
    getMock.mockResolvedValueOnce({ data: { items: [summary('c1', 'Jane')], nextCursor: null } });
    const ProvenanceTable = await loadProvenanceTable();

    render(<ProvenanceTable status="flagged" verdict="fail" />);
    await screen.findByText('Jane');

    expect(getMock).toHaveBeenCalledWith('/v1/admin/provenance', {
      params: { query: { status: 'flagged', verdict: 'fail' } },
    });
  });

  it('renders a missing score as not checked and a present one as a percentage', async () => {
    getMock.mockResolvedValueOnce({
      data: { items: [summary('c1', 'Jane', null), summary('c2', 'John', 0.42)], nextCursor: null },
    });
    const ProvenanceTable = await loadProvenanceTable();

    render(<ProvenanceTable status="pending_review" />);

    expect(await screen.findByText('Not checked')).toBeInTheDocument();
    expect(screen.getByText('42%')).toBeInTheDocument();
  });

  it('applies the same note and reason to every selected id on bulk reject and keeps the failed row selected', async () => {
    getMock.mockResolvedValue({
      data: { items: [summary('c1', 'Jane'), summary('c2', 'John')], nextCursor: null },
    });
    postMock
      .mockResolvedValueOnce({ data: { id: 'c1' } })
      .mockResolvedValueOnce({ error: { code: 'CONFLICT' } });
    const ProvenanceTable = await loadProvenanceTable();
    const events = userEvent.setup();

    render(<ProvenanceTable status="pending_review" />);
    await events.click(await screen.findByRole('checkbox', { name: 'Select image by Jane' }));
    await events.click(screen.getByRole('checkbox', { name: 'Select image by John' }));
    await events.click(screen.getByRole('button', { name: 'Reject selected' }));

    const dialog = await screen.findByRole('dialog');
    await events.type(within(dialog).getByLabelText(/Internal note/), 'Stock photo match');
    await events.selectOptions(within(dialog).getByLabelText(/^Reason \(/), 'not_own_work');
    await events.click(within(dialog).getByRole('button', { name: 'Apply to selected' }));

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledTimes(2);
    });
    const body = {
      status: 'rejected',
      note: 'Stock photo match',
      decisionReason: 'not_own_work',
    };
    expect(postMock).toHaveBeenNthCalledWith(1, '/v1/admin/provenance/{id}/decision', {
      params: { path: { id: 'c1' } },
      body,
    });
    expect(postMock).toHaveBeenNthCalledWith(2, '/v1/admin/provenance/{id}/decision', {
      params: { path: { id: 'c2' } },
      body,
    });
    expect(
      await within(dialog).findByText(/Failed: That couldn't be completed because/),
    ).toBeInTheDocument();

    await events.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.getByRole('checkbox', { name: 'Select image by Jane' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Select image by John' })).toBeChecked();
  });

  it('blocks a bulk reject without a reason', async () => {
    getMock.mockResolvedValue({ data: { items: [summary('c1', 'Jane')], nextCursor: null } });
    const ProvenanceTable = await loadProvenanceTable();
    const events = userEvent.setup();

    render(<ProvenanceTable status="pending_review" />);
    await events.click(await screen.findByRole('checkbox', { name: 'Select image by Jane' }));
    await events.click(screen.getByRole('button', { name: 'Reject selected' }));
    const dialog = await screen.findByRole('dialog');
    await events.type(within(dialog).getByLabelText(/Internal note/), 'note');
    await events.click(within(dialog).getByRole('button', { name: 'Apply to selected' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/Choose a reason/);
    expect(postMock).not.toHaveBeenCalled();
  });
});
