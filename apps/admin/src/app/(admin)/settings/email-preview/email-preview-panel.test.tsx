import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { components } from '@photoo/api-client';

vi.mock('next-intl', async () => {
  const { mockUseTranslations } = await import('@/testing/mock-translations');
  return { useTranslations: mockUseTranslations };
});

const getMock = vi.fn();
vi.mock('@/lib/api', () => ({ api: { GET: getMock } }));

type EmailTemplateName = components['schemas']['EmailTemplateName'];

const templates: EmailTemplateName[] = ['verify-email', 'reset-password', 'quote_received'];

const preview = {
  subject: 'Verify your email',
  html: '<p>Hello <script>alert(1)</script></p>',
  text: 'Hello',
};

async function loadEmailPreviewPanel() {
  return (await import('./email-preview-panel')).EmailPreviewPanel;
}

describe('EmailPreviewPanel', () => {
  it('fetches the first template in English on mount', async () => {
    getMock.mockResolvedValueOnce({ data: preview });
    const EmailPreviewPanel = await loadEmailPreviewPanel();

    render(<EmailPreviewPanel templates={templates} />);

    await waitFor(() => {
      expect(getMock).toHaveBeenCalledWith('/v1/admin/email-templates/{template}/preview', {
        params: { path: { template: 'verify-email' }, query: { locale: 'en' } },
      });
    });
  });

  it('shows a loading state before the preview resolves', async () => {
    getMock.mockReturnValueOnce(new Promise(() => undefined));
    const EmailPreviewPanel = await loadEmailPreviewPanel();

    render(<EmailPreviewPanel templates={templates} />);

    expect(screen.getByRole('status')).toHaveTextContent('Loading...');
  });

  it('renders the subject, sandboxed iframe and text body once loaded', async () => {
    getMock.mockResolvedValueOnce({ data: preview });
    const EmailPreviewPanel = await loadEmailPreviewPanel();

    render(<EmailPreviewPanel templates={templates} />);

    expect(await screen.findByText('Verify your email')).toBeInTheDocument();
    const iframe = screen.getByTitle('HTML');
    expect(iframe).toHaveAttribute('sandbox', '');
    expect(iframe).toHaveAttribute('srcdoc', preview.html);
    expect(screen.getByText('Hello')).toBeInTheDocument();
  });

  it('refetches when the template changes', async () => {
    getMock.mockResolvedValueOnce({ data: preview }).mockResolvedValueOnce({
      data: { subject: 'Reset your password', html: '<p>Reset</p>', text: 'Reset' },
    });
    const EmailPreviewPanel = await loadEmailPreviewPanel();
    const events = userEvent.setup();
    render(<EmailPreviewPanel templates={templates} />);
    await screen.findByText('Verify your email');

    await events.selectOptions(screen.getByLabelText('Template'), 'reset-password');

    await waitFor(() => {
      expect(getMock).toHaveBeenLastCalledWith('/v1/admin/email-templates/{template}/preview', {
        params: { path: { template: 'reset-password' }, query: { locale: 'en' } },
      });
    });
    expect(await screen.findByText('Reset your password')).toBeInTheDocument();
  });

  it('refetches when the locale changes', async () => {
    getMock
      .mockResolvedValueOnce({ data: preview })
      .mockResolvedValueOnce({
        data: { subject: 'A new quote', html: '<p>Quote</p>', text: 'Quote' },
      })
      .mockResolvedValueOnce({
        data: { subject: 'A new quote', html: '<p>Quote</p>', text: 'Quote' },
      });
    const EmailPreviewPanel = await loadEmailPreviewPanel();
    const events = userEvent.setup();
    render(<EmailPreviewPanel templates={templates} />);
    await screen.findByText('Verify your email');

    await events.selectOptions(screen.getByLabelText('Template'), 'quote_received');
    await screen.findByText('A new quote');

    await events.selectOptions(screen.getByLabelText('Locale'), 'fr');

    await waitFor(() => {
      expect(getMock).toHaveBeenLastCalledWith('/v1/admin/email-templates/{template}/preview', {
        params: { path: { template: 'quote_received' }, query: { locale: 'fr' } },
      });
    });
  });

  it('disables the locale select and shows a note for an auth template', async () => {
    getMock.mockResolvedValueOnce({ data: preview });
    const EmailPreviewPanel = await loadEmailPreviewPanel();
    render(<EmailPreviewPanel templates={templates} />);
    await screen.findByText('Verify your email');

    expect(screen.getByLabelText('Locale')).toBeDisabled();
    expect(screen.getByText('Account emails are always sent in English')).toBeInTheDocument();
  });

  it('enables the locale select and hides the note for a transactional template', async () => {
    getMock.mockResolvedValueOnce({ data: preview }).mockResolvedValueOnce({
      data: { subject: 'A new quote', html: '<p>Quote</p>', text: 'Quote' },
    });
    const EmailPreviewPanel = await loadEmailPreviewPanel();
    const events = userEvent.setup();
    render(<EmailPreviewPanel templates={templates} />);
    await screen.findByText('Verify your email');

    await events.selectOptions(screen.getByLabelText('Template'), 'quote_received');
    await screen.findByText('A new quote');

    expect(screen.getByLabelText('Locale')).toBeEnabled();
    expect(screen.queryByText('Account emails are always sent in English')).not.toBeInTheDocument();
  });

  it('shows a mapped error message and retries on demand', async () => {
    getMock
      .mockResolvedValueOnce({ error: { code: 'NOT_FOUND' } })
      .mockResolvedValueOnce({ data: preview });
    const EmailPreviewPanel = await loadEmailPreviewPanel();
    const events = userEvent.setup();
    render(<EmailPreviewPanel templates={templates} />);

    expect(await screen.findByRole('alert')).toHaveTextContent("This couldn't be found.");
    expect(screen.queryByText('Verify your email')).not.toBeInTheDocument();

    await events.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('Verify your email')).toBeInTheDocument();
    expect(getMock).toHaveBeenCalledTimes(2);
  });

  it('renders an empty state when there are no templates to preview', async () => {
    const EmailPreviewPanel = await loadEmailPreviewPanel();

    render(<EmailPreviewPanel templates={[]} />);

    expect(screen.getByText('No email templates are available to preview.')).toBeInTheDocument();
    expect(getMock).not.toHaveBeenCalled();
  });
});
