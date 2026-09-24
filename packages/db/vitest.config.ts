import { defineConfig } from 'vitest/config';
import { ensureScopedTestDatabase } from './src/testing/ensure-test-database.js';

// Scopes TEST_DATABASE_URL to this worktree and workspace before any test file loads; see docs/ARCHITECTURE.md's "Test-database isolation".
if (process.env.TEST_DATABASE_URL && !process.env.PHOTOO_TEST_DATABASE_URL_SCOPED) {
  const scoped = await ensureScopedTestDatabase(process.env.TEST_DATABASE_URL, 'db');
  process.env.TEST_DATABASE_URL = scoped.url;
  process.env.PHOTOO_TEST_DATABASE_URL_SCOPED = '1';
}

export default defineConfig({
  test: {
    // Integration tests share one Postgres database (TEST_DATABASE_URL);
    // running files in parallel races on shared rows (e.g. the Country seed).
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      enabled: true,
      include: ['src/**/*.ts'],
      exclude: [
        // Prisma-generated client: no hand-written logic to cover.
        'src/generated/**',
        // Barrel re-export with no logic of its own.
        'src/testing/index.ts',
        // Only exercised via this file's own top-level call in vitest.config.ts,
        // in vitest's main process before pool workers start - v8 never
        // instruments that call, so it never shows up as covered even though
        // every integration run here exercises it. Needs a real Postgres to
        // test directly, so it's covered by pnpm test:integration, not here.
        'src/testing/ensure-test-database.ts',
      ],
      thresholds: {
        statements: 75,
        branches: 66,
        functions: 82,
        lines: 75,
      },
    },
  },
});
