import { randomBytes } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import { SLUG_MAX_LENGTH, slugify } from '@photoo/shared';
import type { PrismaService } from '../../prisma/prisma.service.js';

const MAX_ATTEMPTS = 10;
const RANDOM_SUFFIX_LENGTH = 6;

function randomSuffix(): string {
  return randomBytes(4).toString('hex').slice(0, RANDOM_SUFFIX_LENGTH);
}

function withSuffix(base: string, suffix: string | null): string {
  if (!suffix) {
    return base;
  }
  const suffixText = `-${suffix}`;
  const trimmed = base.slice(0, SLUG_MAX_LENGTH - suffixText.length).replace(/-+$/, '');
  return `${trimmed}${suffixText}`;
}

// Slugs are always server-generated (never accepted from clients), title
// slugified plus a random suffix on collision (docs/steps/1A.13-professionals.md).
// A linear 1..999 suffix walk lets one account exhaust a popular title's
// namespace (999 sequential `findUnique` calls, then a 500) and makes that
// title permanently uncreatable for everyone else; a random suffix drawn
// from a 16^6 space can't be exhausted and costs at most MAX_ATTEMPTS
// queries.
export async function generateUniqueJobOfferSlug(
  prisma: PrismaService,
  title: string,
): Promise<string> {
  const base = slugify(title, { fallback: 'job-offer' });

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const candidate = withSuffix(base, attempt === 0 ? null : randomSuffix());
    const existing = await prisma.client.jobOffer.findUnique({
      where: { slug: candidate },
      select: { id: true },
    });
    if (!existing) {
      return candidate;
    }
  }

  throw new HttpException(
    {
      code: 'CONFLICT',
      message: `job-board: could not generate a unique slug for "${title}"`,
    },
    409,
  );
}
