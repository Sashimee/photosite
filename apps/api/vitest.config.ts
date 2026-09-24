import { ensureScopedTestDatabase, scopedRedisUrl } from '@photoo/db/testing';
import { defineConfig } from 'vitest/config';

// Scopes TEST_DATABASE_URL/REDIS_URL to this worktree and workspace before any test file loads; see docs/ARCHITECTURE.md's "Test-database isolation".
// Both SCOPED guards make this idempotent: vitest re-evaluates this config in-process on every watch-mode rerun, and without them each rerun would re-clone the database and re-claim (leaking) a Redis slot.
if (process.env.TEST_DATABASE_URL && !process.env.PHOTOO_TEST_DATABASE_URL_SCOPED) {
  const scoped = await ensureScopedTestDatabase(process.env.TEST_DATABASE_URL, 'api');
  process.env.TEST_DATABASE_URL = scoped.url;
  process.env.PHOTOO_TEST_DATABASE_URL_SCOPED = '1';
}
if (process.env.REDIS_URL && !process.env.PHOTOO_TEST_REDIS_URL_SCOPED) {
  process.env.REDIS_URL = await scopedRedisUrl(process.env.REDIS_URL, 'api');
  process.env.PHOTOO_TEST_REDIS_URL_SCOPED = '1';
}

export default defineConfig({
  test: {
    testTimeout: 15000,
    hookTimeout: 15000,
    // Integration suites share one Postgres database, one Redis instance
    // and one Mailpit inbox (TEST_DATABASE_URL/REDIS_URL, and Mailpit is
    // process-wide with no per-suite namespace); running files in parallel
    // races on shared rows, rate-limit keys, chat socket state and which
    // suite's poll picks up which email (#288, #304). Same fix as
    // packages/db and apps/worker's own fileParallelism: false.
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      enabled: true,
      include: ['src/**/*.ts'],
      exclude: [
        // Process entry point: loads env and calls app.listen(); the same
        // bootstrap pieces (configureApp, createFastifyAdapter) are exercised
        // directly by src/testing/create-test-app.ts in every integration test.
        'src/main.ts',
        // Runs initSentry() as an import side effect so it executes before
        // any other module; initSentry() itself is covered directly by
        // sentry-init.test.ts.
        'src/instrument.ts',
        // Test-only fixtures with no branching logic of their own: a fixed
        // env object, a thin createTestApp wrapper, a Mailpit HTTP poller and
        // a TOTP code generator used only to simulate an authenticator app.
        // requireIntegrationEnv keeps its own dedicated test and stays covered.
        'src/testing/create-test-app.ts',
        'src/testing/test-env.ts',
        'src/testing/test-email-worker.module.ts',
        'src/testing/mailpit.ts',
        'src/testing/totp.ts',
      ],
      thresholds: {
        statements: 85,
        branches: 67,
        functions: 90,
        lines: 86,
      },
    },
  },
});
