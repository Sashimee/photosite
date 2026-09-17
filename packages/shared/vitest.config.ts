import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      enabled: true,
      include: ['src/**/*.ts'],
      exclude: [
        // CLI entry point: writes openapi.json as a side effect of import and
        // just calls buildOpenApiDocument, which contract/openapi.test.ts
        // already covers directly.
        'src/scripts/**',
      ],
      thresholds: {
        statements: 98,
        branches: 95,
        functions: 99,
        lines: 99,
      },
    },
  },
});
