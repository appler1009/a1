import { defineConfig, devices } from '@playwright/test';
import crypto from 'crypto';

// Stable run ID shared across all workers in a single `playwright test` invocation.
// Workers that start after the first still get the same ID because it's computed once
// at config-load time and injected via env.
process.env.PW_RUN_ID ??= crypto.randomBytes(6).toString('hex');

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
