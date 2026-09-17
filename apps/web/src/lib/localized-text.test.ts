import { describe, expect, it } from 'vitest';

import { resolveLocalizedText } from './localized-text';

describe('resolveLocalizedText', () => {
  it('returns the route locale when present', () => {
    expect(resolveLocalizedText({ en: 'Hello', fr: 'Bonjour' }, 'fr')).toEqual({
      text: 'Bonjour',
      locale: 'fr',
    });
  });

  it('falls back to en when the route locale is missing', () => {
    expect(resolveLocalizedText({ en: 'Hello', de: 'Hallo' }, 'fr')).toEqual({
      text: 'Hello',
      locale: 'en',
    });
  });

  it('falls back to the first available locale when neither the route locale nor en are present', () => {
    expect(resolveLocalizedText({ de: 'Hallo', pt: 'Olá' }, 'fr')).toEqual({
      text: 'Hallo',
      locale: 'de',
    });
  });

  it('returns null for an empty object', () => {
    expect(resolveLocalizedText({}, 'en')).toBeNull();
  });

  it('returns null for null or undefined', () => {
    expect(resolveLocalizedText(null, 'en')).toBeNull();
    expect(resolveLocalizedText(undefined, 'en')).toBeNull();
  });
});
