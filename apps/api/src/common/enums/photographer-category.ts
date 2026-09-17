import type { PhotographerCategory as PrismaPhotographerCategory } from '@photoo/db';
import type { PhotographerCategory } from '@photoo/shared';

// Postgres enum values can't contain a hyphen, so schema.prisma maps the
// `real_estate` identifier to the `real-estate` label actually stored in the
// database (packages/db/src/enums.test.ts). Prisma Client's generated types
// use the identifier; the wire contract and the raw SQL columns use the
// hyphenated label. This is the one place that converts between them.
export function toPrismaCategory(category: PhotographerCategory): PrismaPhotographerCategory {
  return category.replaceAll('-', '_') as PrismaPhotographerCategory;
}

export function toWireCategory(category: string): PhotographerCategory {
  return category.replaceAll('_', '-') as PhotographerCategory;
}
