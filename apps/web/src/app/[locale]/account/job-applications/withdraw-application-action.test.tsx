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

async function loadWithdrawApplicationAction() {
  const { WithdrawApplicationAction } = await import('./withdraw-application-action');
  return WithdrawApplicationAction;
}

describe('WithdrawApplicationAction', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    refreshMock.mockReset();
  });

  it.each(['shortlisted', 'rejected', 'withdrawn'] as const)(
    'renders nothing once the application is no longer submitted (%s)',
    async (status) => {
      const WithdrawApplicationAction = await loadWithdrawApplicationAction();

      const { container } = render(
        <WithdrawApplicationAction applicationId="application-1" status={status} />,
      );

      expect(container).toBeEmptyDOMElement();
    },
  );

  it('withdraws a submitted application and refreshes', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ status: 'withdrawn' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const WithdrawApplicationAction = await loadWithdrawApplicationAction();
    const user = userEvent.setup({ delay: null });

    render(<WithdrawApplicationAction applicationId="application-1" status="submitted" />);

    await user.click(screen.getByRole('button', { name: 'Withdraw' }));
    await user.click(screen.getByRole('button', { name: 'Yes, withdraw' }));

    const [request] = fetchMock.mock.calls[0] as [Request];
    expect(request.url).toContain('/v1/job-applications/application-1/status');
    const body = (await request.json()) as { status: string };
    expect(body).toEqual({ status: 'withdrawn' });
    expect(refreshMock).toHaveBeenCalled();
  });

  it('maps a 409 to "already decided" and keeps the dialog open', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ code: 'CONFLICT' }), { status: 409 }));
    vi.stubGlobal('fetch', fetchMock);
    const WithdrawApplicationAction = await loadWithdrawApplicationAction();
    const user = userEvent.setup({ delay: null });

    render(<WithdrawApplicationAction applicationId="application-1" status="submitted" />);

    await user.click(screen.getByRole('button', { name: 'Withdraw' }));
    await user.click(screen.getByRole('button', { name: 'Yes, withdraw' }));

    expect(
      await screen.findByText(translate('web.jobApplications.mine', 'errors.alreadyDecided')),
    ).toBeInTheDocument();
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
