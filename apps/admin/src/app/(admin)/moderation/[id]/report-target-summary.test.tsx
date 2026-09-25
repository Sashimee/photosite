import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next-intl/server', async () => {
  const { mockUseFormatter, translate } = await import('@/testing/mock-translations');
  return {
    getFormatter: () => mockUseFormatter(),
    getTranslations: (namespace: string) => (key: string, values?: Record<string, unknown>) =>
      translate(namespace, key, values),
  };
});

async function renderSummary(
  props: Parameters<typeof import('./report-target-summary').ReportTargetSummary>[0],
) {
  const { ReportTargetSummary } = await import('./report-target-summary');
  return render(await ReportTargetSummary(props));
}

describe('ReportTargetSummary', () => {
  it('renders a removed state instead of a broken viewer when the target row is gone', async () => {
    await renderSummary({ targetType: 'portfolio_image', target: null });

    expect(screen.getByText('This content is gone')).toBeInTheDocument();
    expect(screen.getByText(/no longer exists/)).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('names the target type in the removed state even for an unrecognised legacy value', async () => {
    await renderSummary({ targetType: 'comment', target: null });

    expect(screen.getByText(/comment/)).toBeInTheDocument();
  });

  it('renders a photographer profile summary, including an anonymised one exactly as returned', async () => {
    await renderSummary({
      targetType: 'photographer_profile',
      target: {
        targetType: 'photographer_profile',
        displayName: 'Deleted user',
        slug: 'deleted-abc123',
        isPublished: false,
        deletedAt: null,
      },
    });

    expect(screen.getByText('Deleted user')).toBeInTheDocument();
    expect(screen.getByText('deleted-abc123')).toBeInTheDocument();
  });

  it('renders a portfolio image with its preview and dimensions', async () => {
    await renderSummary({
      targetType: 'portfolio_image',
      target: {
        targetType: 'portfolio_image',
        url: 'https://media.example.com/photo.jpg',
        width: 1200,
        height: 800,
        status: 'flagged',
        deletedAt: null,
      },
    });

    const image = screen.getByRole('img');
    expect(image).toHaveAttribute('src', 'https://media.example.com/photo.jpg');
    expect(image).toHaveAttribute('referrerPolicy', 'no-referrer');
  });

  it('renders a request summary', async () => {
    await renderSummary({
      targetType: 'request',
      target: {
        targetType: 'request',
        title: 'Wedding photographer needed',
        description: 'Looking for someone in Luxembourg City.',
        deletedAt: null,
      },
    });

    expect(screen.getByText('Wedding photographer needed')).toBeInTheDocument();
    expect(screen.getByText('Looking for someone in Luxembourg City.')).toBeInTheDocument();
  });

  it('renders a job offer summary including the company name', async () => {
    await renderSummary({
      targetType: 'job_offer',
      target: {
        targetType: 'job_offer',
        title: 'Second shooter for weddings',
        description: 'Weekend availability required.',
        companyName: 'Studio Lumière',
        deletedAt: null,
      },
    });

    expect(screen.getByText('Second shooter for weddings')).toBeInTheDocument();
    expect(screen.getByText('Weekend availability required.')).toBeInTheDocument();
  });

  it('renders a job application summary naming the job offer it was sent to', async () => {
    await renderSummary({
      targetType: 'job_application',
      target: {
        targetType: 'job_application',
        message: 'I would love to shoot this event.',
        jobOfferTitle: 'Second shooter for weddings',
        deletedAt: null,
      },
    });

    expect(screen.getByText('I would love to shoot this event.')).toBeInTheDocument();
  });

  it('shows an already-taken-down notice when the target has been removed', async () => {
    await renderSummary({
      targetType: 'request',
      target: {
        targetType: 'request',
        title: 'Wedding photographer needed',
        description: 'Looking for someone in Luxembourg City.',
        deletedAt: '2026-09-20T00:00:00.000Z',
      },
    });

    expect(screen.getByRole('status')).toHaveTextContent(
      'Taken down on Sep 20, 2026, 2:00 AM GMT+2.',
    );
  });
});
