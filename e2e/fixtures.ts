import { test as base, request as baseRequest, devices, type BrowserContext } from '@playwright/test';

const SERVER_URL = process.env.API_URL || 'http://localhost:5173';

type StorageState = Awaited<ReturnType<BrowserContext['storageState']>>;

type TestFixtures = {
  /** A Page that is already authenticated and has a role selected. */
  authenticatedPage: import('@playwright/test').Page;
  /** A Page authenticated with iPhone SE device emulation (touch, Safari UA, 375×667). */
  mobileAuthenticatedPage: import('@playwright/test').Page;
  /** The email of this worker's test user. */
  testEmail: string;
};

type WorkerFixtures = {
  /**
   * Worker-scoped: one test user per Playwright worker per run.
   * Uses the magic-link flow: requests a link (server returns testToken in
   * non-production), verifies it to get a real session cookie, then completes
   * onboarding once. The storage state is shared across all tests in this worker.
   */
  workerAuth: { email: string; storageState: StorageState };
};

export const test = base.extend<TestFixtures, WorkerFixtures>({
  workerAuth: [
    async ({ browser }, use, workerInfo) => {
      const runId = process.env.PW_RUN_ID || Date.now().toString();
      const email = `test-w${workerInfo.workerIndex}-${runId}@test.local`;

      const apiContext = await baseRequest.newContext({ baseURL: SERVER_URL });

      // Step 1: Request a magic link. In non-production the server echoes back
      // the raw token so we can verify it without a real email service.
      const requestRes = await apiContext.post('/api/auth/magic-link/request', {
        data: { email },
      });
      if (!requestRes.ok()) {
        const body = await requestRes.text();
        await apiContext.dispose();
        throw new Error(`magic-link/request failed: ${requestRes.status()} ${body}`);
      }
      const requestData = await requestRes.json();
      const testToken: string | undefined = requestData.data?.testToken;
      await apiContext.dispose();
      if (!testToken) {
        throw new Error(
          'magic-link/request did not return testToken — is the server running in non-production mode?',
        );
      }

      // Step 2: Navigate the browser through the normal verify flow.
      // This calls /api/auth/magic-link/verify, sets the session cookie, AND
      // stores the user in Zustand's persisted localStorage — both are required.
      const context = await browser.newContext();
      const page = await context.newPage();

      try {
        await page.goto(`/login/verify?token=${testToken}`);

        // The verify page redirects to / after ~1.5 s on success.
        await page.waitForURL('/', { timeout: 10000 });

        // Wait for either the role-creation prompt or the chat input.
        const createRoleBtn = page.getByRole('button', { name: /create your first role/i });
        const chatInput = page.getByPlaceholder('Type a message...');

        await Promise.race([
          createRoleBtn.waitFor({ state: 'visible', timeout: 15000 }),
          chatInput.waitFor({ state: 'visible', timeout: 15000 }),
        ]);

        if (await createRoleBtn.isVisible()) {
          await createRoleBtn.click();
          await page.locator('input[placeholder="Enter role name..."]').fill('Test Role');
          await page.getByRole('button', { name: 'Create Role', exact: true }).click();
          // Wait for the dialog to close before expecting the chat input
          await page.getByRole('button', { name: 'Create Role', exact: true }).waitFor({ state: 'hidden', timeout: 10000 });
        }

        await chatInput.waitFor({ state: 'visible', timeout: 20000 });
      } catch (error) {
        await context.close();
        throw error;
      }

      const storageState = await context.storageState();
      await context.close();

      await use({ email, storageState });

      // Teardown: delete the test user and all associated data.
      try {
        const cleanupContext = await baseRequest.newContext({ baseURL: SERVER_URL });
        await cleanupContext.post('/api/test/cleanup', { data: { email } });
        await cleanupContext.dispose();
      } catch {
        // Best-effort — the test DB is separate from production anyway.
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

    // Set up the response waiter BEFORE navigating so we catch the initial
    // fetchMessages GET that fires immediately on mount. Silence the rejection
    // so a slow response never aborts the fixture.
    const messagesLoaded = page
      .waitForResponse(
        (resp) =>
          resp.url().includes('/api/messages?') &&
          resp.request().method() === 'GET',
        { timeout: 15000 },
      )
      .catch(() => null);

    await page.goto('/');

    await page
      .getByPlaceholder('Type a message...')
      .waitFor({ state: 'visible', timeout: 15000 });

    // Wait for the initial message fetch to finish so the store is stable
    // before the test interacts. Without this, addMessage() can race with
    // fetchMessages() completing and overwriting the store.
    await messagesLoaded;

    await use(page);
    await context.close();
  },

  /**
   * Like authenticatedPage but emulates an iPhone SE:
   * 375×667 viewport, touch enabled, Safari user-agent, deviceScaleFactor 2.
   */
  mobileAuthenticatedPage: async ({ browser, workerAuth }, use) => {
    const context = await browser.newContext({
      ...devices['iPhone SE'],
      storageState: workerAuth.storageState,
    });
    const page = await context.newPage();

    const messagesLoaded = page
      .waitForResponse(
        (resp) =>
          resp.url().includes('/api/messages?') &&
          resp.request().method() === 'GET',
        { timeout: 15000 },
      )
      .catch(() => null);

    await page.goto('/');

    await page
      .getByPlaceholder('Type a message...')
      .waitFor({ state: 'visible', timeout: 15000 });

    await messagesLoaded;

    await use(page);
    await context.close();
  },
});

export { expect } from '@playwright/test';
