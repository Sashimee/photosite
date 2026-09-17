import { describe, expect, it } from 'vitest';
import { checkCatalogs, extractArguments, flattenCatalog } from './catalog.js';

describe('flattenCatalog', () => {
  it('flattens nested namespaces into dot paths', () => {
    expect([...flattenCatalog({ a: { b: 'x', c: { d: 'y' } }, e: 'z' })]).toEqual([
      ['a.b', 'x'],
      ['a.c.d', 'y'],
      ['e', 'z'],
    ]);
  });

  it('returns an empty map for an empty catalog', () => {
    expect(flattenCatalog({}).size).toBe(0);
  });
});

describe('extractArguments', () => {
  it('returns nothing for plain text', () => {
    expect(extractArguments('Hello world')).toEqual(new Set());
  });

  it('collects simple, number, plural, select and nested arguments', () => {
    expect(
      extractArguments(
        '{name} paid {amount, number} for {count, plural, one {# photo by {author}} other {# photos}} ({kind, select, a {A} other {B}})',
      ),
    ).toEqual(
      new Set(['name:argument', 'amount:number', 'count:plural', 'author:argument', 'kind:select']),
    );
  });

  it('throws on invalid ICU syntax', () => {
    expect(() => extractArguments('{unclosed')).toThrow();
  });
});

describe('checkCatalogs', () => {
  const en = { greeting: { hello: 'Hello {name}', items: '{count, plural, one {#} other {#}}' } };

  it('passes a complete, consistent translation', () => {
    const fr = {
      greeting: { hello: 'Bonjour {name}', items: '{count, plural, one {#} other {#}}' },
    };
    expect(checkCatalogs(en, { fr }, { strict: true })).toEqual({ errors: [], warnings: [] });
  });

  it('reports keys that do not exist in en', () => {
    const { errors } = checkCatalogs(
      en,
      { fr: { greeting: { bye: 'Au revoir' } } },
      { strict: false },
    );
    expect(errors).toEqual([
      { kind: 'extra-key', locale: 'fr', key: 'greeting.bye', detail: 'key does not exist in en' },
    ]);
  });

  it('reports a renamed placeholder', () => {
    const { errors } = checkCatalogs(
      en,
      { de: { greeting: { hello: 'Hallo {nom}' } } },
      { strict: false },
    );
    expect(errors.map((e) => [e.kind, e.key])).toEqual([['argument-mismatch', 'greeting.hello']]);
  });

  it('reports a plural turned into a plain argument', () => {
    const { errors } = checkCatalogs(
      en,
      { pt: { greeting: { items: '{count}' } } },
      { strict: false },
    );
    expect(errors.map((e) => [e.kind, e.key])).toEqual([['argument-mismatch', 'greeting.items']]);
  });

  it('reports invalid ICU in a translation and in en', () => {
    const { errors } = checkCatalogs(
      { broken: '{oops' },
      { es: { broken: '{oops' } },
      { strict: false },
    );
    expect(errors.map((e) => [e.kind, e.locale])).toEqual([
      ['invalid-icu', 'en'],
      ['invalid-icu', 'es'],
    ]);
  });

  it('treats missing keys as warnings unless strict', () => {
    expect(checkCatalogs(en, { fr: {} }, { strict: false })).toMatchObject({
      errors: [],
      warnings: [{ kind: 'missing-key' }, { kind: 'missing-key' }],
    });
    expect(checkCatalogs(en, { fr: {} }, { strict: true })).toMatchObject({
      errors: [{ kind: 'missing-key' }, { kind: 'missing-key' }],
      warnings: [],
    });
  });
});
