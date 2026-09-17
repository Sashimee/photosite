import { PHOTOGRAPHER_CATEGORIES } from '@photoo/shared';
import { describe, expect, it } from 'vitest';
import { toPrismaCategory, toWireCategory } from './photographer-category.js';

describe('toPrismaCategory / toWireCategory', () => {
  it('round-trips every wire category through the Prisma identifier', () => {
    for (const category of PHOTOGRAPHER_CATEGORIES) {
      expect(toWireCategory(toPrismaCategory(category))).toBe(category);
    }
  });

  it('maps real-estate to the real_estate Prisma identifier', () => {
    expect(toPrismaCategory('real-estate')).toBe('real_estate');
  });

  it('maps the real_estate Prisma identifier back to real-estate', () => {
    expect(toWireCategory('real_estate')).toBe('real-estate');
  });

  it('is a no-op for categories without a hyphen or underscore', () => {
    expect(toPrismaCategory('wedding')).toBe('wedding');
    expect(toWireCategory('wedding')).toBe('wedding');
  });

  it('maps the raw database label (as returned by raw SQL) back to the wire form', () => {
    expect(toWireCategory('real-estate')).toBe('real-estate');
  });
});
