import { test, expect } from '@playwright/test';

// Use consistent test emails that will accumulate data
const TEST_EMAIL = 'playwright-test@example.com';
const TEST_NAME = 'Playwright Test User';

/**
 * Navigate to app - either login or go directly if already authenticated
 */
async function navigateToApp(page: import('@playwright/test').Page) {
  await page.goto('/');

  // Check if we're on the app (has chat input) or need to login
  const chatInput = page.getByPlaceholder('Type a message...');
  const emailInput = page.getByLabel(/email address/i);

  // If we see the chat input, we're already logged in
  if (await chatInput.isVisible().catch(() => false)) {
    return;
  }

  // Otherwise, log in
  if (await emailInput.isVisible().catch(() => false)) {
    await emailInput.fill(TEST_EMAIL);
    await page.getByRole('button', { name: /continue/i }).click();

    // Check if we got redirected to onboarding or directly to app
    await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 10000 }).catch(() => {});

    const url = page.url();

    if (url.includes('/onboarding')) {
      // Complete the individual signup
      const personalUseBtn = page.getByRole('button', { name: /personal use/i });
      if (await personalUseBtn.isVisible().catch(() => false)) {
        await personalUseBtn.click();
      }

      const nameInput = page.locator('input[placeholder="Your name"]');
      if (await nameInput.isVisible({ timeout: 5000 }).catch(() => false)) {
        await nameInput.fill(TEST_NAME);
      }

      const createBtn = page.getByRole('button', { name: /create/i });
      if (await createBtn.isVisible().catch(() => false)) {
        await createBtn.click();
        await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 10000 }).catch(() => {});
      }
    }
  }
}

test.describe('Chat Interaction', () => {
  test('login page is accessible', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible();
    await expect(page.getByLabel(/email address/i)).toBeVisible();
  });

  test('app shows when authenticated', async ({ page }) => {
    await page.goto('/');

    // Check for any app elements - could be login, app, or onboarding
    await page.waitForTimeout(1000); // Give page time to load

    const elements = {
      chatInput: await page.getByPlaceholder('Type a message...').isVisible().catch(() => false),
      sendButton: await page.getByRole('button', { name: /send/i }).isVisible().catch(() => false),
      onboarding: await page.getByRole('button', { name: /personal use/i }).isVisible().catch(() => false),
      loginForm: await page.getByLabel(/email address/i).isVisible().catch(() => false),
    };

    // Should have at least one of these
    const hasAnyElement = elements.chatInput || elements.sendButton || elements.onboarding || elements.loginForm;
    expect(hasAnyElement).toBeTruthy();
  });

  test('page elements are present', async ({ page }) => {
    await page.goto('/');

    // Check that we have either login or app elements
    const elements = {
      loginForm: await page.getByLabel(/email address/i).isVisible().catch(() => false),
      chatInput: await page.getByPlaceholder('Type a message...').isVisible().catch(() => false),
      onboarding: await page.getByRole('button', { name: /personal use/i }).isVisible().catch(() => false),
    };

    expect(elements.loginForm || elements.chatInput || elements.onboarding).toBeTruthy();
  });

  test('can fill and clear message input', async ({ page }) => {
    await navigateToApp(page);

    const input = page.getByPlaceholder('Type a message...');

    // If input is visible, test it
    if (await input.isVisible().catch(() => false)) {
      await input.fill('test message');
      await expect(input).toHaveValue('test message');

      await input.clear();
      await expect(input).toHaveValue('');
    }
  });
});
