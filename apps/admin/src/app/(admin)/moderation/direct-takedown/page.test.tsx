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

const lookupFormMock = vi.fn(() => <div data-testid="lookup-form" />);
const resultMock = vi.fn(() => <div data-testid="direct-takedown-result" />);
vi.mock('./direct-takedown-lookup-form', () => ({ DirectTakedownLookupForm: lookupFormMock }));
vi.mock('./direct-takedown-result', () => ({ DirectTakedownResult: resultMock }));

function firstCallProps(mock: { mock: { calls: unknown[][] } }) {
  return mock.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
}

async function loadPage() {
  const mod = await import('./page');
  return mod.default;
}

describe('DirectTakedownPage', () => {
  it('renders only the lookup form with no slug given', async () => {
    serverApiMock.mockResolvedValue({ GET: vi.fn() });
    const DirectTakedownPage = await loadPage();

    render(await DirectTakedownPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByText('Take down without a report')).toBeInTheDocument();
    expect(screen.getByTestId('lookup-form')).toBeInTheDocument();
    expect(screen.queryByTestId('direct-takedown-result')).not.toBeInTheDocument();
    expect(screen.queryByText('Nothing found')).not.toBeInTheDocument();
  });

  it('looks up a photographer profile by slug and renders the result', async () => {
    const getMock = vi.fn().mockResolvedValueOnce({
      data: { id: 'profile-1', slug: 'jane-doe', displayName: 'Jane Doe Photography' },
    });
    serverApiMock.mockResolvedValue({ GET: getMock });
    const DirectTakedownPage = await loadPage();

    render(
      await DirectTakedownPage({
        searchParams: Promise.resolve({ targetType: 'photographer_profile', slug: 'jane-doe' }),
      }),
    );

    expect(getMock).toHaveBeenCalledWith('/v1/photographers/{slug}', {
      params: { path: { slug: 'jane-doe' } },
    });
    expect(firstCallProps(resultMock)).toEqual({
      targetType: 'photographer_profile',
      targetId: 'profile-1',
      targetLabel: 'Jane Doe Photography',
      slug: 'jane-doe',
    });
  });

  it('looks up a job offer by slug through the job-board endpoint', async () => {
    const getMock = vi.fn().mockResolvedValueOnce({
      data: { id: 'offer-1', slug: 'second-shooter', title: 'Wedding second shooter' },
    });
    serverApiMock.mockResolvedValue({ GET: getMock });
    const DirectTakedownPage = await loadPage();

    render(
      await DirectTakedownPage({
        searchParams: Promise.resolve({ targetType: 'job_offer', slug: 'second-shooter' }),
      }),
    );

    expect(getMock).toHaveBeenCalledWith('/v1/job-offers/{slug}', {
      params: { path: { slug: 'second-shooter' } },
    });
    expect(firstCallProps(resultMock)).toEqual({
      targetType: 'job_offer',
      targetId: 'offer-1',
      targetLabel: 'Wedding second shooter',
      slug: 'second-shooter',
    });
  });

  it('shows a not-found notice, not the result, when the slug does not resolve', async () => {
    const getMock = vi.fn().mockResolvedValueOnce({ data: undefined, response: { status: 404 } });
    serverApiMock.mockResolvedValue({ GET: getMock });
    const DirectTakedownPage = await loadPage();

    render(
      await DirectTakedownPage({
        searchParams: Promise.resolve({ targetType: 'photographer_profile', slug: 'nobody' }),
      }),
    );

    expect(screen.getByText('Nothing found')).toBeInTheDocument();
    expect(screen.queryByTestId('direct-takedown-result')).not.toBeInTheDocument();
  });
});
