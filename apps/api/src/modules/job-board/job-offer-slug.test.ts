import { HttpException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { generateUniqueJobOfferSlug } from './job-offer-slug.js';

function fakePrisma(isTaken: (slug: string) => boolean): {
  prisma: PrismaService;
  findUnique: ReturnType<typeof vi.fn>;
} {
  const findUnique = vi.fn(({ where }: { where: { slug: string } }) =>
    Promise.resolve(isTaken(where.slug) ? { id: 'existing' } : null),
  );
  return {
    prisma: { client: { jobOffer: { findUnique } } } as unknown as PrismaService,
    findUnique,
  };
}

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

describe('generateUniqueJobOfferSlug', () => {
  it('ASCII-folds, lowercases and hyphenates the title', async () => {
    const { prisma } = fakePrisma(() => false);
    expect(await generateUniqueJobOfferSlug(prisma, 'Wedding Photographer Needed!')).toBe(
      'wedding-photographer-needed',
    );
  });

  it('falls back to "job-offer", not the profile fallback, for a title with no ASCII letters', async () => {
    const { prisma } = fakePrisma(() => false);
    expect(await generateUniqueJobOfferSlug(prisma, '日本語')).toBe('job-offer');
  });

  it('adds a random suffix on collision, not a sequential -2', async () => {
    const { prisma } = fakePrisma((slug) => slug === 'jane-doe-photography');
    const slug = await generateUniqueJobOfferSlug(prisma, 'Jane Doe Photography');
    expect(slug).toMatch(/^jane-doe-photography-[0-9a-f]{6}$/);
    expect(slug).not.toBe('jane-doe-photography-2');
  });

  it('gives up after a bounded number of attempts instead of degrading into hundreds of queries', async () => {
    const { prisma, findUnique } = fakePrisma(() => true);
    await expect(generateUniqueJobOfferSlug(prisma, 'Always Taken')).rejects.toThrow(HttpException);
    expect(findUnique.mock.calls.length).toBeLessThanOrEqual(10);
  });

  it('never produces a double hyphen when a truncated base already ends in one', async () => {
    const title = `${'a'.repeat(52)} ${'a'.repeat(7)}`;
    const base = `${'a'.repeat(52)}-${'a'.repeat(7)}`;
    const { prisma } = fakePrisma((slug) => slug === base);
    const slug = await generateUniqueJobOfferSlug(prisma, title);
    expect(slug).toMatch(SLUG_PATTERN);
    expect(slug).not.toContain('--');
  });
});
