import { defineConfig } from 'vitest/config';
import { ensureScopedTestDatabase } from './src/testing/ensure-test-database.js';

// Points TEST_DATABASE_URL at a database scoped to this worktree and this
// workspace before any test file loads (#225): every worktree and every
// concurrent `turbo run test` task otherwise shares one `photoo_test`.
// Vitest resolves this config once, before spawning pool workers, so the
// mutation below is inherited by every worker's process.env.
if (process.env.TEST_DATABASE_URL) {
  const scoped = await ensureScopedTestDatabase(process.env.TEST_DATABASE_URL, 'db');
  process.env.TEST_DATABASE_URL = scoped.url;
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
        // Runs from this file, in vitest's main config-resolution process,
        // before pool workers start - v8 coverage only instruments worker
        // processes, so this never shows up as covered even though every
        // integration run here exercises it.
        'src/testing/ensure-test-database.ts',
        'src/testing/scoped-redis-url.ts',
        'src/testing/worktree-scope.ts',
        'src/testing/index.ts',
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
