import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const LOCALE_DIR = join(import.meta.dirname);

// `private-routes-noindex.test.ts` covers the "guarded" side of the split
// (a page with `if (!user)`/`if (!session)` must be noindex); this file
// covers the other side: a page that carries `alternates:` at all - i.e.
// every public route - must build it from the shared helpers, not a
// hand-rolled `${env.NEXT_PUBLIC_SITE_URL}/${locale}${path}` and a
// per-page locale map (docs/steps/1B.11-seo.md: "the gap is coverage - a
// test that every public route exports metadata using it, rather than each
// page remembering to").
function pageFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      found.push(...pageFiles(full));
    } else if (entry === 'page.tsx') {
      found.push(full);
    }
  }
  return found;
}

const publicPages = pageFiles(LOCALE_DIR)
  .map((path) => ({ path, source: readFileSync(path, 'utf8') }))
  .filter(({ source }) => /alternates:\s*\{/.test(source))
  .map(({ path }) => [path.slice(LOCALE_DIR.length + 1), path] as const);

describe('every public route builds canonical + hreflang from the shared helpers', () => {
  it('finds the public pages, so an empty scan cannot pass vacuously', () => {
    expect(publicPages.length).toBeGreaterThan(4);
  });

  it.each(publicPages)(
    '%s imports absoluteUrl and localeAlternates from lib/site-url',
    (_name, path) => {
      const source = readFileSync(path, 'utf8');
      expect(source).toMatch(/import\s*\{[^}]*\babsoluteUrl\b[^}]*\}\s*from\s*'@\/lib\/site-url'/);
      expect(source).toMatch(
        /import\s*\{[^}]*\blocaleAlternates\b[^}]*\}\s*from\s*'@\/lib\/site-url'/,
      );
    },
  );

  it.each(publicPages)(
    '%s never hand-rolls the site origin instead of using the helpers',
    (_name, path) => {
      const source = readFileSync(path, 'utf8');
      expect(source).not.toMatch(/NEXT_PUBLIC_SITE_URL/);
    },
  );

  it.each(publicPages)('%s declares exactly one `alternates` block', (_name, path) => {
    const source = readFileSync(path, 'utf8');
    const matches = source.match(/alternates:\s*\{/g) ?? [];
    expect(matches).toHaveLength(1);
  });
});
