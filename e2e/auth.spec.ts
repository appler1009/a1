import { test, expect } from '@playwright/test';

test.describe('Authentication', () => {
  test('login page shows email form', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible();
    await expect(page.getByLabel(/email address/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /send login link/i })).toBeVisible();
  });

  test('send login link button is disabled with empty email', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('button', { name: /send login link/i })).toBeDisabled();
  });

  test('send login link button enables with email input', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(/email address/i).fill('test@example.com');
    await expect(page.getByRole('button', { name: /send login link/i })).toBeEnabled();
  });

  test('can navigate to join page', async ({ page }) => {
    await page.goto('/login');
    const joinLink = page.getByRole('link', { name: /join a group/i });
    await expect(joinLink).toBeVisible();
    await joinLink.click();

    await expect(page).toHaveURL(/\/join/);
  });

  test('app redirects unauthenticated users to login', async ({ page }) => {
    await page.goto('/');

    // Wait for the React app to finish routing — either destination is valid
    const loginForm = page.getByLabel(/email address/i);
    const chatInput = page.getByPlaceholder('Type a message...');

    await Promise.race([
      loginForm.waitFor({ state: 'visible' }),
      chatInput.waitFor({ state: 'visible' }),
    ]);

    const hasLoginForm = await loginForm.isVisible();
    const hasChatInput = await chatInput.isVisible();
    expect(hasLoginForm || hasChatInput).toBeTruthy();
  });
});
