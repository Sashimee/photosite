import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    // e2e/**/*.spec.ts (1B.12) is Playwright's suite, run via `pnpm
    // test:e2e`/its own `playwright.config.ts` project, not Vitest's -
    // without this, Vitest's default include glob (**/*.spec.ts) picks up
    // those files too and fails them (`test.describe() to be called here`,
    // since they never run under the Playwright test runner).
    exclude: [...configDefaults.exclude, 'e2e/**'],
    // Component tests here render, drive `userEvent` and await a mocked
    // fetch; that is comfortably under a second locally and close to (or
    // over) vitest's 5s default on a CI runner, so they failed only on CI.
    // The work is real - give it room rather than trimming assertions to
    // fit an arbitrary limit. `apps/admin` carries the same setting.
    testTimeout: 20000,
    env: {
      NEXT_PUBLIC_API_URL: 'http://127.0.0.1:4010',
      NEXT_PUBLIC_SITE_URL: 'http://127.0.0.1:3000',
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
