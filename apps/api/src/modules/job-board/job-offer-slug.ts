import { SLUG_MAX_LENGTH, slugify } from '@photoo/shared';
import type { PrismaService } from '../../prisma/prisma.service.js';

function withSuffix(base: string, suffix: number): string {
  if (suffix === 1) {
    return base;
  }
  const suffixText = `-${String(suffix)}`;
  return `${base.slice(0, SLUG_MAX_LENGTH - suffixText.length)}${suffixText}`;
}

// Slugs are always server-generated (never accepted from clients), title
// slugified plus a short numeric suffix on collision
// (docs/steps/1A.13-professionals.md), the same shape as
// profiles/slug.ts's generateUniqueSlug but against `JobOffer.slug`.
export async function generateUniqueJobOfferSlug(
  prisma: PrismaService,
  title: string,
): Promise<string> {
  const base = slugify(title);

  for (let suffix = 1; suffix < 1000; suffix += 1) {
    const candidate = withSuffix(base, suffix);
    const existing = await prisma.client.jobOffer.findUnique({
      where: { slug: candidate },
      select: { id: true },
    });
    if (!existing) {
      return candidate;
    }
  }

  throw new Error(`job-board: could not generate a unique slug for "${title}"`);
}
