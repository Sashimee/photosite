import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { generateUniqueSlug } from './slug.js';

function fakePrisma(takenSlugs: readonly string[]): PrismaService {
  return {
    client: {
      photographerProfile: {
        findUnique: vi.fn(({ where }: { where: { slug: string } }) =>
          Promise.resolve(takenSlugs.includes(where.slug) ? { id: 'existing' } : null),
        ),
      },
    },
  } as unknown as PrismaService;
}

describe('generateUniqueSlug', () => {
  it('ASCII-folds, lowercases and hyphenates the display name', async () => {
    const prisma = fakePrisma([]);
    expect(await generateUniqueSlug(prisma, 'Jàne Döe Photography')).toBe('jane-doe-photography');
  });

  it('truncates to 60 characters', async () => {
    const prisma = fakePrisma([]);
    const longName = 'a'.repeat(100);
    const slug = await generateUniqueSlug(prisma, longName);
    expect(slug.length).toBeLessThanOrEqual(60);
  });

  it('suffixes -2 on a collision', async () => {
    const prisma = fakePrisma(['jane-doe']);
    expect(await generateUniqueSlug(prisma, 'Jane Doe')).toBe('jane-doe-2');
  });

  it('suffixes -3 when -2 is also taken', async () => {
    const prisma = fakePrisma(['jane-doe', 'jane-doe-2']);
    expect(await generateUniqueSlug(prisma, 'Jane Doe')).toBe('jane-doe-3');
  });

  it('skips a reserved word straight to a suffix', async () => {
    const prisma = fakePrisma([]);
    expect(await generateUniqueSlug(prisma, 'Admin')).toBe('admin-2');
  });

  it('skips a reserved route segment', async () => {
    const prisma = fakePrisma([]);
    expect(await generateUniqueSlug(prisma, 'Sign In')).toBe('sign-in-2');
  });

  it('falls back to a default base when the display name has no ASCII letters', async () => {
    const prisma = fakePrisma([]);
    expect(await generateUniqueSlug(prisma, '日本語')).toBe('photographer');
  });

  // A 2-letter slug would be indistinguishable from a country landing route
  // segment (docs/steps/1B.4-discovery.md); no display name, however short
  // or collision-prone, may ever produce one.
  it.each(['a', 'ab', 'lu', 'FR', '1', '12', '-', '  ab  ', 'a1', '日本'])(
    'never produces a 2-character slug for %j',
    async (displayName) => {
      const prisma = fakePrisma([]);
      const slug = await generateUniqueSlug(prisma, displayName);
      expect(slug.length).not.toBe(2);
    },
  );

  it('never produces a 2-character slug across suffix collisions', async () => {
    const prisma = fakePrisma(['lu', 'lu-2', 'lu-3']);
    const slug = await generateUniqueSlug(prisma, 'lu');
    expect(slug.length).not.toBe(2);
  });
});
