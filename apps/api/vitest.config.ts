import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    testTimeout: 15000,
    hookTimeout: 15000,
    coverage: {
      provider: 'v8',
      enabled: true,
      include: ['src/**/*.ts'],
      exclude: [
        // Process entry point: loads env and calls app.listen(); the same
        // bootstrap pieces (configureApp, createFastifyAdapter) are exercised
        // directly by src/testing/create-test-app.ts in every integration test.
        'src/main.ts',
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
