import { describe, expect, it } from '@jest/globals';

import { resolveDeviceLocale } from './i18n';

describe('resolveDeviceLocale', () => {
  it('picks the first supported locale from the device locale list', () => {
    expect(resolveDeviceLocale([{ languageTag: 'fr-FR' }, { languageTag: 'en-US' }])).toBe('fr');
  });

  it('falls back to the default locale when no device locale is supported', () => {
    expect(resolveDeviceLocale([{ languageTag: 'ja-JP' }])).toBe('en');
  });

  it('falls back to the default locale when there are no device locales', () => {
    expect(resolveDeviceLocale([])).toBe('en');
  });
});
