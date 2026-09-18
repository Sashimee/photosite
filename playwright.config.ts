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
    {
      name: 'smoke',
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'], storageState: AUTH_STATE_PATH },
    },
  ],
});
