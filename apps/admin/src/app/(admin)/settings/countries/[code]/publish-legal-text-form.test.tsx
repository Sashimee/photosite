import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { components } from '@photoo/api-client';

vi.mock('next-intl', async () => {
  const { mockUseTranslations } = await import('@/testing/mock-translations');
  return { useTranslations: mockUseTranslations };
});

const refreshMock = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: refreshMock }) }));

const postMock = vi.fn();
vi.mock('@/lib/api', () => ({ api: { POST: postMock } }));

type AdminCountry = components['schemas']['AdminCountry'];

const country: AdminCountry = {
  code: 'LU',
  name: 'Luxembourg',
  currency: 'EUR',
  enabled: true,
  vatRate: 17,
  defaultLocale: 'fr',
  accountCount: 42,
};

async function loadPublishLegalTextForm() {
  return (await import('./publish-legal-text-form')).PublishLegalTextForm;
}

async function renderForm() {
  const PublishLegalTextForm = await loadPublishLegalTextForm();
  const events = userEvent.setup();
  render(<PublishLegalTextForm country={country} />);
  return { events };
}

async function fillAndSubmit(
  events: ReturnType<typeof userEvent.setup>,
  overrides: { kind?: string; content?: string } = {},
) {
  const { kind = 'terms', content = 'Some terms content' } = overrides;
  if (kind !== '') {
    await events.type(screen.getByLabelText('Kind'), kind);
  }
  if (content !== '') {
    await events.type(screen.getByLabelText('Content'), content);
  }
  await events.click(screen.getByRole('button', { name: 'Publish' }));
}

async function confirmPublish(events: ReturnType<typeof userEvent.setup>) {
  await events.click(screen.getByRole('button', { name: 'Publish version' }));
}

describe('PublishLegalTextForm', () => {
  it('rejects an empty kind and shows the field error only for kind', async () => {
    const { events } = await renderForm();

    await fillAndSubmit(events, { kind: '', content: 'Some content' });

    expect(postMock).not.toHaveBeenCalled();
    expect(await screen.findByText('This field is required.')).toBeInTheDocument();
    expect(screen.getAllByText('This field is required.')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Publish version' })).not.toBeInTheDocument();
  });

  it('rejects empty content and shows the field error only for content', async () => {
    const { events } = await renderForm();

    await fillAndSubmit(events, { kind: 'terms', content: '' });

    expect(postMock).not.toHaveBeenCalled();
    expect(await screen.findByText('This field is required.')).toBeInTheDocument();
    expect(screen.getAllByText('This field is required.')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Publish version' })).not.toBeInTheDocument();
  });

  it('rejects whitespace-only content as if it were empty', async () => {
    const { events } = await renderForm();

    await fillAndSubmit(events, { kind: 'terms', content: '   ' });

    expect(postMock).not.toHaveBeenCalled();
    expect(await screen.findByText('This field is required.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Publish version' })).not.toBeInTheDocument();
  });

  it('shows two field errors when both kind and content are empty', async () => {
    const { events } = await renderForm();

    await fillAndSubmit(events, { kind: '', content: '' });

    expect(postMock).not.toHaveBeenCalled();
    expect(await screen.findAllByText('This field is required.')).toHaveLength(2);
  });

  it('opens a confirm dialog naming the kind, locale and country before publishing', async () => {
    const { events } = await renderForm();

    await fillAndSubmit(events, { kind: 'terms', content: 'Some terms content' });

    expect(screen.getByText('Publish terms?')).toBeInTheDocument();
    expect(
      screen.getByText(
        "This publishes a new French version of terms for Luxembourg. It becomes what every user in Luxembourg sees, and can't be edited once published.",
      ),
    ).toBeInTheDocument();
    expect(postMock).not.toHaveBeenCalled();
  });

  it('submits the kind, locale and content, with no id or version in the payload', async () => {
    postMock.mockResolvedValueOnce({
      data: {
        version: '2',
        kind: 'terms',
        locale: 'fr',
        content: 'Some terms content',
        publishedAt: '2026-01-01T00:00:00.000Z',
        publishedByAdminId: 'admin-1',
      },
    });
    const { events } = await renderForm();

    await fillAndSubmit(events, { kind: 'terms', content: 'Some terms content' });
    await confirmPublish(events);

    expect(postMock).toHaveBeenCalledWith('/v1/admin/countries/{code}/legal-texts', {
      params: { path: { code: 'LU' } },
      body: { kind: 'terms', locale: 'fr', content: 'Some terms content' },
    });
    const [, options] = postMock.mock.calls[0] as [string, { body: Record<string, unknown> }];
    expect(options.body).not.toHaveProperty('id');
    expect(options.body).not.toHaveProperty('version');
    expect(refreshMock).toHaveBeenCalled();
  });

  it('resets the form fields after a successful publish', async () => {
    postMock.mockResolvedValueOnce({
      data: {
        version: '2',
        kind: 'terms',
        locale: 'de',
        content: 'Some terms content',
        publishedAt: '2026-01-01T00:00:00.000Z',
        publishedByAdminId: 'admin-1',
      },
    });
    const { events } = await renderForm();

    await events.selectOptions(screen.getByLabelText('Locale'), 'de');
    await fillAndSubmit(events, { kind: 'terms', content: 'Some terms content' });
    await confirmPublish(events);

    expect(screen.getByLabelText('Kind')).toHaveValue('');
    expect(screen.getByLabelText('Content')).toHaveValue('');
    expect(screen.getByLabelText('Locale')).toHaveValue('fr');
  });

  it('submits the selected locale', async () => {
    postMock.mockResolvedValueOnce({
      data: {
        version: '2',
        kind: 'terms',
        locale: 'de',
        content: 'Some terms content',
        publishedAt: '2026-01-01T00:00:00.000Z',
        publishedByAdminId: 'admin-1',
      },
    });
    const { events } = await renderForm();

    await events.selectOptions(screen.getByLabelText('Locale'), 'de');
    await fillAndSubmit(events, { kind: 'terms', content: 'Some terms content' });
    await confirmPublish(events);

    expect(postMock).toHaveBeenCalledWith('/v1/admin/countries/{code}/legal-texts', {
      params: { path: { code: 'LU' } },
      body: { kind: 'terms', locale: 'de', content: 'Some terms content' },
    });
  });

  it('surfaces an API error, does not reset the form, and does not claim success', async () => {
    postMock.mockResolvedValueOnce({ error: { code: 'CONFLICT' } });
    const { events } = await renderForm();

    await fillAndSubmit(events, { kind: 'terms', content: 'Some terms content' });
    await confirmPublish(events);

    expect(
      await screen.findByText(
        "That couldn't be completed because something changed. Please retry.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Kind')).toHaveValue('terms');
    expect(screen.getByLabelText('Content')).toHaveValue('Some terms content');
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it('does not render an error message for a TWO_FACTOR_REQUIRED response', async () => {
    postMock.mockResolvedValueOnce({ error: { code: 'TWO_FACTOR_REQUIRED' } });
    const { events } = await renderForm();

    await fillAndSubmit(events, { kind: 'terms', content: 'Some terms content' });
    await confirmPublish(events);

    expect(postMock).toHaveBeenCalled();
    expect(refreshMock).not.toHaveBeenCalled();
    expect(screen.queryByText('Something went wrong. Please try again.')).not.toBeInTheDocument();
  });

  it('rejects a kind over 60 characters with a field error and blocks publish', async () => {
    const { events } = await renderForm();
    const tooLongKind = 'a'.repeat(61);

    fireEvent.change(screen.getByLabelText('Kind'), { target: { value: tooLongKind } });
    await events.type(screen.getByLabelText('Content'), 'Some content');
    await events.click(screen.getByRole('button', { name: 'Publish' }));

    expect(postMock).not.toHaveBeenCalled();
    expect(await screen.findByText('This value is too long.')).toBeInTheDocument();
    expect(screen.getByLabelText('Kind')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.queryByRole('button', { name: 'Publish version' })).not.toBeInTheDocument();
  });
});
