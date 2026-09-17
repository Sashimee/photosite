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
      ],
      thresholds: {
        statements: 48,
        branches: 60,
        functions: 55,
        lines: 48,
      },
    },
  },
});
