import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests run against a running OpenInc with an empty database: `pnpm dev` (default,
 * http://localhost:5173) or the production image (E2E_BASE_URL=http://localhost:8080).
 * They walk the first-run wizard, so they need a fresh database each time.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
