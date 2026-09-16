import { describe, expect, it } from 'vitest';

import { buildLocaleSwitchHref } from './locale-switch';

describe('buildLocaleSwitchHref', () => {
  it('replaces the locale segment while preserving the rest of the path', () => {
    expect(buildLocaleSwitchHref('/en/photographers/paris', 'fr')).toBe('/fr/photographers/paris');
  });

  it('switches the locale for the home page', () => {
    expect(buildLocaleSwitchHref('/en', 'de')).toBe('/de');
  });

  it('falls back to the target locale root for an unprefixed path', () => {
    expect(buildLocaleSwitchHref('/photographers', 'es')).toBe('/es');
  });
});
