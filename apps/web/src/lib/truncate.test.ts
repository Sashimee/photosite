import { describe, expect, it } from 'vitest';

import { truncateAtWordBoundary } from './truncate';

describe('truncateAtWordBoundary', () => {
  it('returns the text unchanged when it fits within maxLength', () => {
    expect(truncateAtWordBoundary('Short bio.', 160)).toBe('Short bio.');
  });

  it('cuts at the last space before maxLength and appends an ellipsis', () => {
    const text = 'Documentary-style wedding and portrait photography across Luxembourg City.';
    expect(truncateAtWordBoundary(text, 40)).toBe('Documentary-style wedding and portrait…');
  });

  it('falls back to a hard cut when there is no whitespace before maxLength', () => {
    expect(truncateAtWordBoundary('Supercalifragilisticexpialidocious', 10)).toBe('Supercalif…');
  });

  it('returns the text unchanged when it is exactly maxLength', () => {
    expect(truncateAtWordBoundary('12345', 5)).toBe('12345');
  });
});
