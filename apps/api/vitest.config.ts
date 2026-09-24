import { ensureScopedTestDatabase, scopedRedisUrl } from '@photoo/db/testing';
import { defineConfig } from 'vitest/config';

// Points TEST_DATABASE_URL/REDIS_URL at a database and a Redis logical
// database scoped to this worktree and this workspace before any test file
// loads (#225): every worktree and every concurrent `turbo run test` task
// otherwise shares one `photoo_test` and one Redis (BullMQ queue names,
// rate-limit keys). Vitest resolves this config once, before spawning pool
// workers, so the mutation below is inherited by every worker's
// process.env, and by src/testing/test-env.ts's TEST_ENV, which reads it.
if (process.env.TEST_DATABASE_URL) {
  const scoped = await ensureScopedTestDatabase(process.env.TEST_DATABASE_URL, 'api');
  process.env.TEST_DATABASE_URL = scoped.url;
}
if (process.env.REDIS_URL) {
  process.env.REDIS_URL = scopedRedisUrl(process.env.REDIS_URL, 'api');
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
