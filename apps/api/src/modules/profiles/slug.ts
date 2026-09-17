import { SLUG_MAX_LENGTH, SUPPORTED_LOCALES, slugify } from '@photoo/shared';
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

function withSuffix(base: string, suffix: number): string {
  if (suffix === 1) {
    return base;
  }
  const suffixText = `-${String(suffix)}`;
  return `${base.slice(0, SLUG_MAX_LENGTH - suffixText.length)}${suffixText}`;
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
