import { defineConfig } from 'vitest/config';

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
