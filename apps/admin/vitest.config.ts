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
        // instead. Pure logic these call is unit-tested separately
        // (csp.test.ts, sign-in-path.test.ts, security-headers.test.ts).
        'src/app/**',
        'src/i18n/request.ts',
        'src/proxy.ts',
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
