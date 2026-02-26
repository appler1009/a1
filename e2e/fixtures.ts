import { test as base, request as baseRequest, type BrowserContext } from '@playwright/test';

const SERVER_URL = process.env.API_URL || 'http://localhost:3000';

type StorageState = Awaited<ReturnType<BrowserContext['storageState']>>;

type TestFixtures = {
  /** A Page that is already authenticated and has a role selected. */
  authenticatedPage: import('@playwright/test').Page;
  /** The email of this worker's test user. */
  testEmail: string;
};

type WorkerFixtures = {
  /**
   * Worker-scoped: one test user per Playwright worker per run.
   * Stores the full browser storage state (cookies + localStorage) captured
   * after completing the entire onboarding flow, so each test can restore it
   * instantly without repeating the UI flow.
   */
  workerAuth: { email: string; storageState: StorageState };
};

export const test = base.extend<TestFixtures, WorkerFixtures>({
  workerAuth: [
    async ({ browser }, use, workerInfo) => {
      const runId = process.env.PW_RUN_ID || Date.now().toString();
      const email = `test-w${workerInfo.workerIndex}-${runId}@test.local`;

      // Complete the full signup + role creation flow once per worker.
      // The resulting storage state is shared across all tests in this worker.
      const context = await browser.newContext();
      const page = await context.newPage();

      try {
        // 1. Login page → enter email and continue
        await page.goto('/login');
        await page.getByLabel(/email address/i).fill(email);
        await page.getByRole('button', { name: /continue/i }).click();

        // 2. OnboardingPage → choose "Personal use"
        await page.waitForURL(/\/onboarding/, { timeout: 10000 });
        await page.getByRole('button', { name: /personal use/i }).click();

        // 3. Individual signup form → fill name and create account
        await page.locator('input[placeholder="Your name"]').fill('Test User');
        await page.getByRole('button', { name: /create account/i }).click();

        // 4. OnboardingPane → create the first role
        await page
          .getByRole('button', { name: /create your first role/i })
          .waitFor({ state: 'visible', timeout: 15000 });
        await page.getByRole('button', { name: /create your first role/i }).click();

        // 5. CreateRoleDialog → fill role name and submit
        await page.locator('input[placeholder="Enter role name..."]').fill('Test Role');
        await page.getByRole('button', { name: 'Create Role', exact: true }).click();

        // 6. Wait for the chat input — signals full auth + role selection complete
        await page
          .getByPlaceholder('Type a message...')
          .waitFor({ state: 'visible', timeout: 15000 });
      } catch (error) {
        await context.close();
        throw error;
      }

      // Capture cookies + localStorage so tests can restore state instantly
      const storageState = await context.storageState();
      await context.close();

      await use({ email, storageState });

      // Teardown: delete the test user and all associated data
      try {
        const apiContext = await baseRequest.newContext({ baseURL: SERVER_URL });
        await apiContext.post('/api/test/cleanup', { data: { email } });
        await apiContext.dispose();
      } catch {
        // Best-effort — the test DB is separate from production anyway
      }
    },
    { scope: 'worker' },
  ],

  testEmail: async ({ workerAuth }, use) => {
    await use(workerAuth.email);
  },

  /**
   * Returns a Page already at the chat screen.
   * Each test gets a fresh browser context (fully isolated) but starts with
   * the worker's pre-captured auth state, so no login UI is needed.
   */
  authenticatedPage: async ({ browser, workerAuth }, use) => {
    const context = await browser.newContext({ storageState: workerAuth.storageState });
    const page = await context.newPage();
    await page.goto('/');

    // Sanity-check: ensure chat is immediately available
    await page
      .getByPlaceholder('Type a message...')
      .waitFor({ state: 'visible', timeout: 10000 });

    await use(page);
    await context.close();
  },
});

export { expect } from '@playwright/test';
