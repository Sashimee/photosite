import { describe, expect, it } from 'vitest';
import { CATALOGS, SUPPORTED_LOCALES, checkCatalogs, getMessages, mergeCatalogs } from './index.js';

describe('mergeCatalogs', () => {
  it('overrides translated leaves and keeps en for the rest', () => {
    expect(
      mergeCatalogs(
        { common: { save: 'Save', cancel: 'Cancel' }, top: 'Top' },
        { common: { save: 'Enregistrer' } },
      ),
    ).toEqual({ common: { save: 'Enregistrer', cancel: 'Cancel' }, top: 'Top' });
  });

  it('does not mutate the fallback catalog', () => {
    const fallback = { common: { save: 'Save' } };
    mergeCatalogs(fallback, { common: { save: 'Speichern' } });
    expect(fallback).toEqual({ common: { save: 'Save' } });
  });
});

describe('getMessages', () => {
  it('has a catalog for every supported locale', () => {
    expect(Object.keys(CATALOGS).sort()).toEqual([...SUPPORTED_LOCALES].sort());
  });

  it('falls back to en for untranslated locales', () => {
    expect(getMessages('fr').common.save).toBe(getMessages('en').common.save);
  });

  it('falls back to en for unsupported locales', () => {
    expect(getMessages('it')).toEqual(getMessages('en'));
  });
});

describe('shipped catalogs', () => {
  it('have no errors against en', () => {
    const { en, ...translations } = CATALOGS;
    expect(checkCatalogs(en, translations, { strict: false }).errors).toEqual([]);
  });
});
