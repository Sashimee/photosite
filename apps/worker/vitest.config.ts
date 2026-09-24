import { ensureScopedTestDatabase, scopedRedisUrl } from '@photoo/db/testing';
import { defineConfig } from 'vitest/config';

// Scopes TEST_DATABASE_URL/REDIS_URL to this worktree and workspace before any test file loads; see docs/ARCHITECTURE.md's "Test-database isolation".
// Both SCOPED guards make this idempotent: vitest re-evaluates this config in-process on every watch-mode rerun, and without them each rerun would re-clone the database and re-claim (leaking) a Redis slot.
if (process.env.TEST_DATABASE_URL && !process.env.PHOTOO_TEST_DATABASE_URL_SCOPED) {
  const scoped = await ensureScopedTestDatabase(process.env.TEST_DATABASE_URL, 'worker');
  process.env.TEST_DATABASE_URL = scoped.url;
  process.env.PHOTOO_TEST_DATABASE_URL_SCOPED = '1';
}
if (process.env.REDIS_URL && !process.env.PHOTOO_TEST_REDIS_URL_SCOPED) {
  process.env.REDIS_URL = await scopedRedisUrl(process.env.REDIS_URL, 'worker');
  process.env.PHOTOO_TEST_REDIS_URL_SCOPED = '1';
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
