import { test, expect } from '@playwright/test';

test.describe('App Smoke Tests', () => {
  test('app is accessible', async ({ page }) => {
    await page.goto('/');

    // Page should load without errors
    const title = page.locator('h1, h2');
    await expect(title.first()).toBeVisible({ timeout: 10000 });
  });

  test('login page displays correctly', async ({ page }) => {
    await page.goto('/login');

    await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible();
    await expect(page.getByLabel(/email address/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /continue/i })).toBeVisible();
  });

  test('can navigate between pages', async ({ page }) => {
    await page.goto('/login');

    // Check for join link
    const joinLink = page.getByRole('link', { name: /join/i });
    expect(await joinLink.isVisible().catch(() => false)).toBeTruthy();
  });

  test('form validation works', async ({ page }) => {
    await page.goto('/login');

    const continueBtn = page.getByRole('button', { name: /continue/i });

    // Button should be disabled with empty email
    await expect(continueBtn).toBeDisabled();

    // Button should enable with email
    await page.fill('input[type="email"]', 'test@example.com');
    await expect(continueBtn).toBeEnabled();
  });

  test('page handles navigation correctly', async ({ page }) => {
    // Start at root
    await page.goto('/');

    // Should redirect to either login or show app
    const finalUrl = page.url();
    expect(
      finalUrl.includes('/login') ||
      finalUrl === 'http://localhost:5173/' ||
      finalUrl.includes('/onboarding')
    ).toBeTruthy();
  });
});
