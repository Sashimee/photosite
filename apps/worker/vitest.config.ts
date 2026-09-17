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
        // Process entry point: loads env and calls createApplicationContext();
        // the same bootstrap pieces (AppModule, shutdown hooks) are exercised
        // directly by src/testing/create-test-context.ts in every integration
        // test.
        'src/main.ts',
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
