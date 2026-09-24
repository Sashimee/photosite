import { defineConfig, devices } from '@playwright/test';

// https://footoo.bas.lu in the post-deploy job (deploy-preview.yml), the
// local stack's web app everywhere else (CI's browser-smoke job, or a
// developer's `pnpm --filter @photoo/web start`).
const baseURL = process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:3000';

export const AUTH_STATE_PATH = 'tests/smoke/.auth/client.json';

export default defineConfig({
  testDir: './tests/smoke',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    // Chromium only - WebKit will not install on this stack's host (missing
    // system libraries). #180 (sign-in page downloading a file on a real
    // browser) never reproduced under Chromium; this suite cannot see it.
    //
    // `smoke-public` carries no storageState or `setup` dependency because
    // the preview's seed password (deploy-preview.yml) is a pending human
    // follow-up, not always available - the signed-out pages must stay
    // checkable without it.
    {
      name: 'smoke-public',
      testMatch: /signed-out\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'smoke-authenticated',
      testMatch: /signed-in\.spec\.ts/,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'], storageState: AUTH_STATE_PATH },
    },
    // docs/steps/1B.12-web-e2e.md: a second, independent suite, not an
    // extension of `tests/smoke` - its own testDir, no `setup`/`smoke-*`
    // dependency and no shared storageState (every spec here signs in its
    // own fixture user via apps/web/e2e/support/sign-in.ts). Workers bounded
    // rather than left at Playwright's local per-core default: the e2e CI
    // job's runner is already running Postgres, Redis, Mailpit, the API and
    // the web server at once, the same CPU-oversubscription shape #201 named
    // for apps/mobile's jest workers.
    {
      name: 'e2e',
      testDir: 'apps/web/e2e',
      testMatch: /.*\.spec\.ts/,
      workers: 2,
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
