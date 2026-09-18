import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { components } from '@photoo/api-client';

import { translate } from '@/testing/mock-translations';

vi.mock('next-intl', async () => {
  const { mockUseTranslations } = await import('@/testing/mock-translations');
  return { useTranslations: mockUseTranslations };
});

const patchMock = vi.fn();
const deleteMock = vi.fn();
vi.mock('@/lib/api', () => ({ api: { PATCH: patchMock, DELETE: deleteMock } }));

type PortfolioImage = components['schemas']['PortfolioImage'];

function image(overrides: Partial<PortfolioImage> = {}): PortfolioImage {
  return {
    id: 'image-1',
    url: 'https://cdn.example/image-1.jpg',
    width: 800,
    height: 600,
    order: 1,
    status: 'approved',
    ...overrides,
  };
}

async function loadManager() {
  const { PortfolioManager } = await import('./portfolio-manager');
  return PortfolioManager;
}

function first<T>(items: readonly T[]): T {
  const [item] = items;
  if (!item) {
    throw new Error('expected at least one item');
  }
  return item;
}

function required<T>(value: T | null): T {
  if (!value) {
    throw new Error('expected a value');
  }
  return value;
}

describe('PortfolioManager', () => {
  afterEach(() => {
    vi.resetModules();
    patchMock.mockReset();
    deleteMock.mockReset();
  });

  it('shows a processing placeholder instead of a broken image or an error while an image has no URL yet', async () => {
    const PortfolioManager = await loadManager();
    render(
      <PortfolioManager
        initialImages={[
          image({ id: 'image-1', url: null, width: null, height: null, status: 'processing' }),
        ]}
      />,
    );

    expect(screen.getByText('Processing…')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.queryByText(/went wrong/i)).not.toBeInTheDocument();
  });

  it('moves an image down from the keyboard and persists the new order', async () => {
    patchMock.mockResolvedValue({
      data: {
        items: [
          image({ id: 'image-2', url: 'https://cdn.example/2.jpg', order: 1 }),
          image({ id: 'image-1', url: 'https://cdn.example/1.jpg', order: 2 }),
        ],
        nextCursor: null,
      },
    });
    const PortfolioManager = await loadManager();
    const user = userEvent.setup({ delay: null });

    render(
      <PortfolioManager
        initialImages={[
          image({ id: 'image-1', url: 'https://cdn.example/1.jpg' }),
          image({ id: 'image-2', url: 'https://cdn.example/2.jpg' }),
        ]}
      />,
    );

    const items = screen.getAllByRole('listitem');
    const firstItem = first(items.filter((item) => within(item).queryByRole('img')));
    await user.click(within(firstItem).getByRole('button', { name: 'Move down' }));

    expect(patchMock).toHaveBeenCalledWith('/v1/me/photographer-profile/portfolio/order', {
      body: { imageIds: ['image-2', 'image-1'] },
    });

    const imgs = await screen.findAllByRole('img');
    expect(imgs[0]).toHaveAttribute('src', expect.stringContaining('2.jpg'));
  });

  it('rolls back and shows a translated error when persisting the order fails', async () => {
    patchMock.mockResolvedValue({ data: undefined, error: { code: 'UNPROCESSABLE_ENTITY' } });
    const PortfolioManager = await loadManager();
    const user = userEvent.setup({ delay: null });

    render(
      <PortfolioManager
        initialImages={[
          image({ id: 'image-1', url: 'https://cdn.example/1.jpg' }),
          image({ id: 'image-2', url: 'https://cdn.example/2.jpg' }),
        ]}
      />,
    );

    await user.click(first(screen.getAllByRole('button', { name: 'Move down' })));

    expect(
      await screen.findByText(translate('web.dashboard.portfolio', 'errors.invalid')),
    ).toBeInTheDocument();
    const imgs = screen.getAllByRole('img');
    expect(imgs[0]).toHaveAttribute('src', expect.stringContaining('1.jpg'));
  });

  it('asks for confirmation before deleting a photo, and only deletes on confirm', async () => {
    deleteMock.mockResolvedValue({ error: undefined });
    const PortfolioManager = await loadManager();
    const user = userEvent.setup({ delay: null });

    render(<PortfolioManager initialImages={[image()]} />);

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.getByText('Delete this photo?')).toBeInTheDocument();
    expect(deleteMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Yes, delete photo' }));

    expect(deleteMock).toHaveBeenCalledWith('/v1/me/photographer-profile/portfolio/{imageId}', {
      params: { path: { imageId: 'image-1' } },
    });
    expect(
      await screen.findByText(translate('web.dashboard.portfolio', 'empty')),
    ).toBeInTheDocument();
  });

  it('maps a 409 conflict from delete to the translated message and keeps the photo', async () => {
    deleteMock.mockResolvedValue({ error: { code: 'CONFLICT' } });
    const PortfolioManager = await loadManager();
    const user = userEvent.setup({ delay: null });

    render(<PortfolioManager initialImages={[image()]} />);
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(screen.getByRole('button', { name: 'Yes, delete photo' }));

    expect(
      await screen.findByText(translate('web.dashboard.portfolio', 'errors.conflict')),
    ).toBeInTheDocument();
    expect(document.querySelectorAll('img')).toHaveLength(1);
  });

  it('maps a 429 with a retry hint from delete to the translated message', async () => {
    deleteMock.mockResolvedValue({
      error: { code: 'TOO_MANY_REQUESTS', details: { retryAfterSeconds: 20 } },
    });
    const PortfolioManager = await loadManager();
    const user = userEvent.setup({ delay: null });

    render(<PortfolioManager initialImages={[image()]} />);
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(screen.getByRole('button', { name: 'Yes, delete photo' }));

    expect(
      await screen.findByText(
        translate('web.dashboard.portfolio', 'errors.tooManyRequestsWithRetry', { seconds: 20 }),
      ),
    ).toBeInTheDocument();
  });

  it('rejects an unsupported file type before starting an upload', async () => {
    const PortfolioManager = await loadManager();
    render(<PortfolioManager initialImages={[]} />);

    const input = required(document.querySelector<HTMLInputElement>('input[type="file"]'));
    const file = new File(['a'], 'a.gif', { type: 'image/gif' });
    fireEvent.change(input, { target: { files: [file] } });

    expect(
      await screen.findByText('Only JPEG, PNG and WEBP images can be uploaded.'),
    ).toBeInTheDocument();
  });
});
