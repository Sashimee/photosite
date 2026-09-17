import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      enabled: true,
      include: ['src/**/*.ts'],
      exclude: [
        // CLI entry point: exits the process and just calls checkCatalogs,
        // which catalog.test.ts already covers directly.
        'src/scripts/**',
      ],
      thresholds: {
        statements: 93,
        branches: 89,
        functions: 99,
        lines: 93,
      },
    },
  },
});
