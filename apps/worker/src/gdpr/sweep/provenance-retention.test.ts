import { describe, expect, it } from 'vitest';
import { rawRetentionCutoff, selectUnheldChecks } from './provenance-retention.js';

const candidates = [
  { checkId: 'c1', imageId: 'i1', profileId: 'p1' },
  { checkId: 'c2', imageId: 'i2', profileId: 'p1' },
  { checkId: 'c3', imageId: 'i3', profileId: 'p2' },
];

describe('selectUnheldChecks', () => {
  it('deletes everything when there are no open reports', () => {
    expect(selectUnheldChecks(candidates, [])).toEqual({
      deletable: ['c1', 'c2', 'c3'],
      held: 0,
    });
  });

  it('holds only the image targeted by an open portfolio_image report', () => {
    const result = selectUnheldChecks(candidates, [
      { targetType: 'portfolio_image', targetId: 'i2' },
    ]);
    expect(result).toEqual({ deletable: ['c1', 'c3'], held: 1 });
  });

  it('holds every image of a profile targeted by an open profile report', () => {
    const result = selectUnheldChecks(candidates, [
      { targetType: 'photographer_profile', targetId: 'p1' },
    ]);
    expect(result).toEqual({ deletable: ['c3'], held: 2 });
  });

  it('ignores reports of other target types sharing an id', () => {
    const result = selectUnheldChecks(candidates, [
      { targetType: 'request', targetId: 'i1' },
      { targetType: 'photographer_profile', targetId: 'i3' },
    ]);
    expect(result.deletable).toEqual(['c1', 'c2', 'c3']);
  });

  it('returns nothing for no candidates', () => {
    expect(selectUnheldChecks([], [{ targetType: 'portfolio_image', targetId: 'i1' }])).toEqual({
      deletable: [],
      held: 0,
    });
  });
});

describe('rawRetentionCutoff', () => {
  it('is exactly 90 days before now', () => {
    const now = Date.UTC(2026, 9, 8);
    expect(rawRetentionCutoff(now).toISOString()).toBe('2026-07-10T00:00:00.000Z');
  });
});
