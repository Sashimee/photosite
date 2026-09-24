import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { translate } from '@/testing/mock-translations';

vi.mock('next-intl', async () => {
  const { mockUseTranslations } = await import('@/testing/mock-translations');
  return { useTranslations: mockUseTranslations };
});

async function loadApplyForm() {
  const { ApplyForm } = await import('./apply-form');
  return ApplyForm;
}

function fillMessage(value = 'I would love to shoot this event.') {
  fireEvent.change(screen.getByLabelText('Message'), { target: { value } });
}

describe('ApplyForm', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('renders every field disabled with a sign-in link when signed out, and never calls the API', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const ApplyForm = await loadApplyForm();

    render(
      <ApplyForm
        jobOfferId="job-1"
        applicationsHref="/en/account/job-applications"
        signInHref="/en/sign-in?next=%2Fen%2Fjob-offers%2Fwedding-photographer-needed"
      />,
    );

    expect(screen.getByLabelText('Message')).toBeDisabled();
    expect(screen.getByLabelText('Portfolio link (optional)')).toBeDisabled();
    expect(screen.getByRole('link', { name: 'Sign in to apply' })).toHaveAttribute(
      'href',
      '/en/sign-in?next=%2Fen%2Fjob-offers%2Fwedding-photographer-needed',
    );
    expect(screen.queryByRole('button', { name: 'Send application' })).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('blocks submission client-side when the message is empty, never reaching the network', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const ApplyForm = await loadApplyForm();
    const user = userEvent.setup({ delay: null });

    render(<ApplyForm jobOfferId="job-1" applicationsHref="/en/account/job-applications" />);
    await user.click(screen.getByRole('button', { name: 'Send application' }));

    expect(
      await screen.findByText('This value is too short.', {
        selector: '#job-application-message-error',
      }),
    ).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('submits a trimmed message and null portfolio link, then shows success and hides the form', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'app-1',
          jobOfferId: 'job-1',
          photographerId: 'photographer-1',
          message: 'I would love to shoot this event.',
          portfolioLink: null,
          status: 'submitted',
          createdAt: '2026-01-01T00:00:00.000Z',
        }),
        { status: 201 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const ApplyForm = await loadApplyForm();
    const user = userEvent.setup({ delay: null });

    render(<ApplyForm jobOfferId="job-1" applicationsHref="/en/account/job-applications" />);
    fireEvent.change(screen.getByLabelText('Message'), {
      target: { value: '  I would love to shoot this event.  ' },
    });
    await user.click(screen.getByRole('button', { name: 'Send application' }));

    expect(
      await screen.findByText('Application sent. The company can now see your message.'),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Message')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'See my applications' })).toHaveAttribute(
      'href',
      '/en/account/job-applications',
    );

    const [request] = fetchMock.mock.calls[0] as [Request];
    expect(request.url).toContain('/v1/job-offers/job-1/applications');
    const body = (await request.json()) as { message: string; portfolioLink: string | null };
    expect(body).toEqual({ message: 'I would love to shoot this event.', portfolioLink: null });
  });

  it('maps a 409 to "already applied" with a link, and never shows the form again', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ code: 'CONFLICT' }), { status: 409 }));
    vi.stubGlobal('fetch', fetchMock);
    const ApplyForm = await loadApplyForm();
    const user = userEvent.setup({ delay: null });

    render(<ApplyForm jobOfferId="job-1" applicationsHref="/en/account/job-applications" />);
    fillMessage();
    await user.click(screen.getByRole('button', { name: 'Send application' }));

    expect(await screen.findByText('You already applied to this offer.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'See my applications' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Message')).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('maps a 429 with a retry hint to the translated message', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ code: 'TOO_MANY_REQUESTS', details: { retryAfterSeconds: 8 } }),
          { status: 429 },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);
    const ApplyForm = await loadApplyForm();
    const user = userEvent.setup({ delay: null });

    render(<ApplyForm jobOfferId="job-1" applicationsHref="/en/account/job-applications" />);
    fillMessage();
    await user.click(screen.getByRole('button', { name: 'Send application' }));

    expect(
      await screen.findByText(
        translate('web.jobBoard.apply', 'errors.tooManyRequestsWithRetry', { seconds: 8 }),
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Message')).toBeInTheDocument();
  });
});
