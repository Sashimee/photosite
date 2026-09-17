import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    env: {
      NEXT_PUBLIC_API_URL: 'http://127.0.0.1:4010',
    },
    setupFiles: ['./vitest.setup.ts'],
    coverage: {
      provider: 'v8',
      enabled: true,
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        // Needs a live Next request to render; covered by Playwright e2e
        // (1B.12) instead. Pure logic these call is unit-tested separately
        // (csp.test.ts, locale-routing.test.ts).
        'src/app/**',
        'src/i18n/request.ts',
        // No branching logic of our own.
        'src/instrumentation.ts',
        'src/instrumentation-client.ts',
        // Test-only helpers, not product code (mirrors apps/api/src/testing).
        'src/testing/**',
      ],
      thresholds: {
        statements: 76,
        branches: 83,
        functions: 74,
        lines: 76,
      },
    },
  },
});
