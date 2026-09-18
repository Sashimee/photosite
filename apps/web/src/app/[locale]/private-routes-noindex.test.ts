import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const LOCALE_DIR = join(import.meta.dirname);

// A page that *requires* a session must not be indexable. `/account` shipped
// without an explicit `robots`, inheriting the root layout's
// `NEXT_PUBLIC_ALLOW_INDEXING` instead (#218) — invisible while every
// environment sets that false, and wrong the moment production sets it true.
// Scanning the source rather than testing one page at a time is what stops
// the next private page joining the index by omission.
//
// The `if (!user)` guard is the discriminator, not merely calling
// `getSession()`: sign-in, two-factor and sign-up read the session to send an
// already-authenticated visitor away (`if (user)`), and they are public entry
// points — sign-up is a landing page ads point at. Whether those should carry
// their own robots rule is an SEO decision for 1B.11, not a correctness bug.
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

const guardedPages = pageFiles(LOCALE_DIR)
  .map((path) => ({ path, source: readFileSync(path, 'utf8') }))
  .filter(({ source }) => /if \(!user\)|if \(!session\)/.test(source))
  .map(({ path }) => [path.slice(LOCALE_DIR.length + 1), path] as const);

describe('private routes are never indexable', () => {
  it('finds the guarded pages, so an empty scan cannot pass vacuously', () => {
    expect(guardedPages.length).toBeGreaterThan(4);
  });

  it.each(guardedPages)('%s opts out of indexing explicitly', (_name, path) => {
    const source = readFileSync(path, 'utf8');
    expect(source).toMatch(/robots:\s*buildRobotsMetadata\(false\)/);
  });
});
