import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { translate } from '@/testing/mock-translations';

const refreshMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));
vi.mock('next-intl', async () => {
  const { mockUseTranslations } = await import('@/testing/mock-translations');
  return { useTranslations: mockUseTranslations };
});

async function loadRejectApplicationAction() {
  const { RejectApplicationAction } = await import('./reject-application-action');
  return RejectApplicationAction;
}

describe('RejectApplicationAction', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    refreshMock.mockReset();
  });

  it.each(['shortlisted', 'rejected', 'withdrawn'] as const)(
    'renders nothing once the application is no longer submitted (%s)',
    async (status) => {
      const RejectApplicationAction = await loadRejectApplicationAction();

      const { container } = render(
        <RejectApplicationAction applicationId="application-1" status={status} />,
      );

      expect(container).toBeEmptyDOMElement();
    },
  );

  it('states the rejection is not reversible in the confirmation', async () => {
    const RejectApplicationAction = await loadRejectApplicationAction();
    const user = userEvent.setup({ delay: null });

    render(<RejectApplicationAction applicationId="application-1" status="submitted" />);
    await user.click(screen.getByRole('button', { name: 'Reject' }));

    expect(
      screen.getByText(translate('web.jobApplications.inbox', 'rejectConfirmDescription')),
    ).toBeInTheDocument();
    expect(screen.getByText(/can't be undone/i)).toBeInTheDocument();
  });

  it('rejects a submitted application and refreshes', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ status: 'rejected' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const RejectApplicationAction = await loadRejectApplicationAction();
    const user = userEvent.setup({ delay: null });

    render(<RejectApplicationAction applicationId="application-1" status="submitted" />);

    await user.click(screen.getByRole('button', { name: 'Reject' }));
    await user.click(screen.getByRole('button', { name: 'Yes, reject' }));

    const [request] = fetchMock.mock.calls[0] as [Request];
    expect(request.url).toContain('/v1/job-applications/application-1/status');
    const body = (await request.json()) as { status: string };
    expect(body).toEqual({ status: 'rejected' });
    expect(refreshMock).toHaveBeenCalled();
  });

  it('maps a 409 to "already decided" and keeps the dialog open', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ code: 'CONFLICT' }), { status: 409 }));
    vi.stubGlobal('fetch', fetchMock);
    const RejectApplicationAction = await loadRejectApplicationAction();
    const user = userEvent.setup({ delay: null });

    render(<RejectApplicationAction applicationId="application-1" status="submitted" />);

    await user.click(screen.getByRole('button', { name: 'Reject' }));
    await user.click(screen.getByRole('button', { name: 'Yes, reject' }));

    expect(
      await screen.findByText(translate('web.jobApplications.inbox', 'errors.alreadyDecided')),
    ).toBeInTheDocument();
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
