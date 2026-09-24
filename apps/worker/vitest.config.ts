import { ensureScopedTestDatabase, scopedRedisUrl } from '@photoo/db/testing';
import { defineConfig } from 'vitest/config';

// Points TEST_DATABASE_URL/REDIS_URL at a database and a Redis logical
// database scoped to this worktree and this workspace before any test file
// loads (#225): every worktree and every concurrent `turbo run test` task
// otherwise shares one `photoo_test` and one Redis (BullMQ queue names -
// apps/api's TestEmailWorkerModule and this workspace's QueueWorkersService
// both run a real Worker on EMAIL_QUEUE_NAME against the same Redis).
// Vitest resolves this config once, before spawning pool workers, so the
// mutation below is inherited by every worker's process.env, and by
// src/testing/test-env.ts's TEST_ENV, which reads it.
if (process.env.TEST_DATABASE_URL) {
  const scoped = await ensureScopedTestDatabase(process.env.TEST_DATABASE_URL, 'worker');
  process.env.TEST_DATABASE_URL = scoped.url;
}
if (process.env.REDIS_URL) {
  process.env.REDIS_URL = scopedRedisUrl(process.env.REDIS_URL, 'worker');
}

export default defineConfig({
  test: {
    // Multiple integration suites bootstrap the full AppModule (QueueWorkersService
    // included) against the same real Redis, so their BullMQ Workers all listen on
    // the same fixed queue names (file-scan, image-process, uploads-cleanup);
    // running files in parallel lets one file's job get picked up by another
    // file's worker instance instead. Same category of fix as packages/db's
    // fileParallelism: false for its shared TEST_DATABASE_URL.
    fileParallelism: false,
    testTimeout: 15000,
    hookTimeout: 15000,
    coverage: {
      provider: 'v8',
      enabled: true,
      include: ['src/**/*.ts'],
      exclude: [
        // Process entry point: loads env and calls createApplicationContext();
        // the same bootstrap pieces (AppModule, shutdown hooks) are exercised
        // directly by src/testing/create-test-context.ts in every integration
        // test.
        'src/main.ts',
        // Runs initSentry() as an import side effect so it executes before
        // any other module; initSentry() itself is covered directly by
        // sentry-init.test.ts.
        'src/instrument.ts',
        // Test-only fixtures with no branching logic of their own: a fixed
        // env object and a thin createTestContext wrapper.
        // requireIntegrationEnv keeps its own dedicated test and stays covered.
        'src/testing/create-test-context.ts',
        'src/testing/test-env.ts',
      ],
      thresholds: {
        statements: 92,
        branches: 83,
        functions: 89,
        lines: 92,
      },
    },
  },
});
