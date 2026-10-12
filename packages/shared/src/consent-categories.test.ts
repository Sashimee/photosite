import { describe, expect, it } from 'vitest';

import {
  CATEGORY_PURPOSES,
  CONSENT_CATEGORIES,
  isPolicyVersionNewer,
} from './consent-categories.js';
import { CONSENT_PURPOSES } from './enums.js';

describe('CATEGORY_PURPOSES', () => {
  it('maps every category to at least one purpose', () => {
    for (const category of CONSENT_CATEGORIES) {
      expect(CATEGORY_PURPOSES[category].length).toBeGreaterThan(0);
    }
  });

  it('keeps ads and marketing as separate purposes under one toggle', () => {
    expect(CATEGORY_PURPOSES.adsMarketing).toEqual(['ads', 'marketing']);
    expect(CATEGORY_PURPOSES.analytics).toEqual(['analytics']);
  });

  it('only uses purposes the API accepts', () => {
    for (const purpose of Object.values(CATEGORY_PURPOSES).flat()) {
      expect(CONSENT_PURPOSES).toContain(purpose);
    }
  });
});

describe('isPolicyVersionNewer', () => {
  it('treats a higher integer as newer', () => {
    expect(isPolicyVersionNewer('2', '1')).toBe(true);
    expect(isPolicyVersionNewer('1', '2')).toBe(false);
    expect(isPolicyVersionNewer('1', '1')).toBe(false);
  });

  it('compares numerically rather than as strings', () => {
    expect(isPolicyVersionNewer('10', '9')).toBe(true);
  });

  it('treats an unpublished (null) current version as never newer', () => {
    expect(isPolicyVersionNewer(null, '1')).toBe(false);
    expect(isPolicyVersionNewer(null, null)).toBe(false);
  });

  it('treats any published version as newer than a decision made with none', () => {
    expect(isPolicyVersionNewer('1', null)).toBe(true);
  });

  it('ranks a non-numeric version like an unpublished one', () => {
    expect(isPolicyVersionNewer('abc', null)).toBe(false);
    expect(isPolicyVersionNewer('1', 'abc')).toBe(true);
  });
});
