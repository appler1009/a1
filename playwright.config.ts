import { defineConfig, devices } from '@playwright/test';
import crypto from 'crypto';
import { execSync } from 'child_process';

// Stable run ID shared across all workers in a single `playwright test` invocation.
process.env.PW_RUN_ID ??= crypto.randomBytes(6).toString('hex');

/**
 * Ask the OS for a free TCP port by binding to port 0, then release it.
 * Uses a child Node process so the binding is synchronous from the config's perspective.
 */
function getFreePort(): number {
  return parseInt(
    execSync(
      `node -e "const n=require('net'),s=n.createServer();s.listen(0,'127.0.0.1',()=>{process.stdout.write(String(s.address().port));s.close()})"`,
    )
      .toString()
      .trim(),
    10,
  );
}

// Compute once in the main process; workers inherit via env and skip getFreePort().
process.env.E2E_SERVER_PORT ??= String(getFreePort());
process.env.E2E_CLIENT_PORT ??= String(getFreePort());

const serverPort = parseInt(process.env.E2E_SERVER_PORT, 10);
const clientPort = parseInt(process.env.E2E_CLIENT_PORT, 10);

// Expose to fixtures (SERVER_URL fallback) and any test helpers
process.env.API_URL = `http://localhost:${clientPort}`;

export default defineConfig({
  testDir: './e2e',
  timeout: 60000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : 3,
  reporter: 'html',
  expect: {
    timeout: 10000,
  },
  use: {
    baseURL: `http://localhost:${clientPort}`,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      // Backend Fastify server — NODE_ENV=e2e loads .env.e2e which has no PORT entry,
      // so dotenv's override:true won't clobber the PORT we set here.
      command: `PORT=${serverPort} NODE_ENV=e2e bun run --filter './server' dev:e2e`,
      port: serverPort,
      reuseExistingServer: false,
      timeout: 30000,
    },
    {
      // Vite frontend — proxies /api to the backend port above
      command: `E2E_CLIENT_PORT=${clientPort} E2E_SERVER_PORT=${serverPort} bun run --filter './client' dev`,
      port: clientPort,
      reuseExistingServer: false,
      timeout: 60000,
    },
  ],
});
