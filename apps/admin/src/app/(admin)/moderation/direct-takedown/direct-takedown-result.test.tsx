import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next-intl', async () => {
  const { mockUseTranslations } = await import('@/testing/mock-translations');
  return { useTranslations: mockUseTranslations };
});

const pushMock = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock }) }));

const postMock = vi.fn();
vi.mock('@/lib/api', () => ({ api: { POST: postMock } }));

async function loadDirectTakedownResult() {
  return (await import('./direct-takedown-result')).DirectTakedownResult;
}

describe('DirectTakedownResult', () => {
  it('shows the target label and slug, and offers takedown', async () => {
    const DirectTakedownResult = await loadDirectTakedownResult();
    render(
      <DirectTakedownResult
        targetType="photographer_profile"
        targetId="profile-1"
        targetLabel="Jane Doe Photography"
        slug="jane-doe-photography"
      />,
    );

    expect(screen.getByText('Jane Doe Photography')).toBeInTheDocument();
    expect(screen.getByText('jane-doe-photography')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Take down' })).toBeInTheDocument();
  });

  it('posts a direct takedown for the resolved target and navigates to the new report', async () => {
    postMock.mockResolvedValueOnce({ data: { id: 'report-9' } });
    const DirectTakedownResult = await loadDirectTakedownResult();
    const events = userEvent.setup();
    render(
      <DirectTakedownResult
        targetType="job_offer"
        targetId="offer-1"
        targetLabel="Wedding second shooter"
        slug="wedding-second-shooter"
      />,
    );

    await events.click(screen.getByRole('button', { name: 'Take down' }));
    await events.type(screen.getByLabelText(/Statement of reasons/), 'Removed for policy.');
    await events.click(screen.getByRole('button', { name: 'Take down content' }));

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledWith('/v1/admin/reports/direct-takedown', {
        body: { targetType: 'job_offer', targetId: 'offer-1', resolution: 'Removed for policy.' },
      });
    });
    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith('/moderation/report-9');
    });
  });
});
