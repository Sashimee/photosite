import { describe, expect, it } from 'vitest';

import { buildRobotsMetadata, buildRobotsRules } from './robots';

describe('buildRobotsRules', () => {
  it('disallows everything when indexing is off', () => {
    expect(buildRobotsRules(false)).toEqual({
      rules: { userAgent: '*', disallow: '/' },
    });
  });

  it('allows everything when indexing is on', () => {
    expect(buildRobotsRules(true)).toEqual({
      rules: { userAgent: '*', allow: '/' },
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
