import { describe, expect, it } from 'vitest';

import { buildRobotsMetadata, buildRobotsRules } from './robots';

describe('buildRobotsRules', () => {
  it('disallows everything when indexing is off, with no sitemap directive', () => {
    expect(buildRobotsRules(false, 'https://photoo.lu')).toEqual({
      rules: { userAgent: '*', disallow: '/' },
    });
  });

  it('allows everything and points at the sitemap when indexing is on', () => {
    expect(buildRobotsRules(true, 'https://photoo.lu')).toEqual({
      rules: { userAgent: '*', allow: '/' },
      sitemap: 'https://photoo.lu/sitemap.xml',
    });
  });
});

describe('buildRobotsMetadata', () => {
  it('sets index and follow to false when indexing is off', () => {
    expect(buildRobotsMetadata(false)).toEqual({ index: false, follow: false });
  });

  it('is undefined when indexing is on', () => {
    expect(buildRobotsMetadata(true)).toBeUndefined();
  });
});
