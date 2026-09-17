import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { translate } from '@/testing/mock-translations';

vi.mock('next-intl/server', () => ({
  getTranslations:
    ({ namespace }: { namespace: string }) =>
    (key: string, values?: Record<string, unknown>) =>
      translate(namespace, key, values),
}));

describe('ProfileLinks', () => {
  it('renders each link as an external anchor labelled with its hostname', async () => {
    const { ProfileLinks } = await import('./profile-links');
    const element = await ProfileLinks({
      links: {
        instagram: 'https://instagram.com/sofia.martins',
        website: 'https://sofiamartins.example/portfolio',
        behance: null,
        other: [{ label: 'Press kit', url: 'https://press.example.com/sofia' }],
      },
      locale: 'en',
    });

    render(element);

    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(3);
    for (const link of links) {
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'nofollow ugc noopener noreferrer');
    }
    expect(screen.getByRole('link', { name: 'instagram.com' })).toHaveAttribute(
      'href',
      'https://instagram.com/sofia.martins',
    );
    expect(screen.getByRole('link', { name: 'sofiamartins.example' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'press.example.com' })).toBeInTheDocument();
  });

  it('renders nothing when there are no links', async () => {
    const { ProfileLinks } = await import('./profile-links');
    const element = await ProfileLinks({
      links: { instagram: null, website: null, behance: null, other: [] },
      locale: 'en',
    });

    expect(element).toBeNull();
  });
});
