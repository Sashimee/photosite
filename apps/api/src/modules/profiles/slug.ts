import { SUPPORTED_LOCALES } from '@photoo/shared';
import type { PrismaService } from '../../prisma/prisma.service.js';

// Route segments of apps/web plus the reserved words from
// docs/steps/1A.4-profiles-products.md. Locale codes are added below so a
// profile can never shadow `photoo.lu/<locale>`.
const RESERVED_PROFILE_SLUGS: ReadonlySet<string> = new Set<string>([
  'admin',
  'api',
  'account',
  'sign-in',
  'sign-up',
  'forgot-password',
  'reset-password',
  'verify-email',
  ...SUPPORTED_LOCALES,
]);

const MAX_SLUG_LENGTH = 60;
const FALLBACK_SLUG_BASE = 'photographer';

function slugify(displayName: string): string {
  const base = displayName
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, '');

  return base.length >= 3 ? base : FALLBACK_SLUG_BASE;
}

function withSuffix(base: string, suffix: number): string {
  if (suffix === 1) {
    return base;
  }
  const suffixText = `-${String(suffix)}`;
  return `${base.slice(0, MAX_SLUG_LENGTH - suffixText.length)}${suffixText}`;
}

// Slugs are always server-generated (never accepted from clients), so
// "the reserved list is rejected" is enforced here by treating a reserved
// word as already taken: it is skipped straight to `-2` like any collision.
export async function generateUniqueSlug(
  prisma: PrismaService,
  displayName: string,
): Promise<string> {
  const base = slugify(displayName);

  for (let suffix = 1; suffix < 1000; suffix += 1) {
    const candidate = withSuffix(base, suffix);
    if (RESERVED_PROFILE_SLUGS.has(candidate)) {
      continue;
    }
    const existing = await prisma.client.photographerProfile.findUnique({
      where: { slug: candidate },
      select: { id: true },
    });
    if (!existing) {
      return candidate;
    }
  }

  throw new Error(`profiles: could not generate a unique slug for "${displayName}"`);
}
