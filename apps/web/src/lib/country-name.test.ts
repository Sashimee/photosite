import { describe, expect, it } from 'vitest';

import { countryDisplayName } from './country-name';

describe('countryDisplayName', () => {
  it('returns the localized region name', () => {
    expect(countryDisplayName('LU', 'en')).toBe('Luxembourg');
    expect(countryDisplayName('LU', 'fr')).toBe('Luxembourg');
    expect(countryDisplayName('LU', 'de')).toBe('Luxemburg');
  });

  it('falls back to the raw code for a malformed region', () => {
    expect(countryDisplayName('1U', 'en')).toBe('1U');
  });
});
