import { describe, expect, it } from 'vitest';
import { DEFAULT_LOCALE, SUPPORTED_LOCALES, isLocale, resolveLocale } from './locale.js';

describe('locale', () => {
  describe('SUPPORTED_LOCALES', () => {
    it('includes en, fr, de, pt, es', () => {
      expect(SUPPORTED_LOCALES).toEqual(['en', 'fr', 'de', 'pt', 'es']);
    });
  });

  describe('DEFAULT_LOCALE', () => {
    it('is en', () => {
      expect(DEFAULT_LOCALE).toBe('en');
    });
  });

  describe('isLocale', () => {
    it('returns true for supported locales', () => {
      expect(isLocale('en')).toBe(true);
      expect(isLocale('fr')).toBe(true);
      expect(isLocale('de')).toBe(true);
      expect(isLocale('pt')).toBe(true);
      expect(isLocale('es')).toBe(true);
    });

    it('returns false for unsupported locales', () => {
      expect(isLocale('it')).toBe(false);
      expect(isLocale('lb')).toBe(false);
      expect(isLocale('en-US')).toBe(false);
    });

    it('returns false for non-strings', () => {
      expect(isLocale(null)).toBe(false);
      expect(isLocale(undefined)).toBe(false);
      expect(isLocale(123)).toBe(false);
      expect(isLocale({})).toBe(false);
    });
  });

  describe('resolveLocale', () => {
    describe('with exact matches', () => {
      it('returns the locale when it matches exactly', () => {
        expect(resolveLocale('en')).toBe('en');
        expect(resolveLocale('fr')).toBe('fr');
        expect(resolveLocale('de')).toBe('de');
        expect(resolveLocale('pt')).toBe('pt');
        expect(resolveLocale('es')).toBe('es');
      });
    });

    describe('with regional variants', () => {
      it('matches regional BCP 47 tags to their primary subtag', () => {
        expect(resolveLocale('fr-LU')).toBe('fr');
        expect(resolveLocale('en-US')).toBe('en');
        expect(resolveLocale('de-CH')).toBe('de');
        expect(resolveLocale('pt-PT')).toBe('pt');
        expect(resolveLocale('es-ES')).toBe('es');
      });

      it('is case-insensitive', () => {
        expect(resolveLocale('FR-LU')).toBe('fr');
        expect(resolveLocale('DE-CH')).toBe('de');
      });
    });

    describe('with Accept-Language lists', () => {
      it('returns the first matching locale from a list', () => {
        expect(resolveLocale(['de', 'en'])).toBe('de');
        expect(resolveLocale(['it', 'fr', 'en'])).toBe('fr');
      });

      it('respects q-values in Accept-Language format', () => {
        expect(resolveLocale(['it;q=0.8', 'fr;q=0.9', 'en;q=1.0'])).toBe('en');
        expect(resolveLocale(['de;q=0.5', 'fr;q=0.9'])).toBe('fr');
      });

      it('processes entries in order when q-values are equal', () => {
        expect(resolveLocale(['de;q=0.9', 'fr;q=0.9'])).toBe('de');
      });

      it('parses a raw Accept-Language header string', () => {
        expect(resolveLocale('it-IT,it;q=0.9,fr-LU;q=0.8,en;q=0.7')).toBe('fr');
        expect(resolveLocale('pt-BR, de;q=0.5')).toBe('pt');
      });

      it('skips empty entries in the list', () => {
        expect(resolveLocale(['', 'fr', 'en'])).toBe('fr');
      });
    });

    describe('with unknown or empty input', () => {
      it('returns DEFAULT_LOCALE for undefined', () => {
        expect(resolveLocale(undefined)).toBe('en');
      });

      it('returns DEFAULT_LOCALE for empty string', () => {
        expect(resolveLocale('')).toBe('en');
      });

      it('returns DEFAULT_LOCALE for empty array', () => {
        expect(resolveLocale([])).toBe('en');
      });

      it('returns DEFAULT_LOCALE for unsupported locale', () => {
        expect(resolveLocale('it')).toBe('en');
        expect(resolveLocale('lb')).toBe('en');
      });

      it('returns DEFAULT_LOCALE for array with only unsupported locales', () => {
        expect(resolveLocale(['it', 'lb', 'ja'])).toBe('en');
      });

      it('returns DEFAULT_LOCALE for array with only empty entries', () => {
        expect(resolveLocale(['', '  ', ''])).toBe('en');
      });
    });
  });
});
