import { test, expect } from './fixtures';

test.describe('App Smoke Tests', () => {
  test('login page displays correctly', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible();
    await expect(page.getByLabel(/email address/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /continue/i })).toBeVisible();
  });

  test('continue button is disabled with empty email', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('button', { name: /continue/i })).toBeDisabled();
  });

  test('continue button enables with email input', async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[type="email"]', 'test@example.com');
    await expect(page.getByRole('button', { name: /continue/i })).toBeEnabled();
  });

  test('unauthenticated root redirects to login or shows app', async ({ page }) => {
    await page.goto('/');
    const finalUrl = page.url();
    expect(
      finalUrl.includes('/login') ||
        finalUrl === 'http://localhost:5173/' ||
        finalUrl.includes('/onboarding')
    ).toBeTruthy();
  });

  test('authenticated user sees app with fresh empty state', async ({
    authenticatedPage: page,
    testEmail,
  }) => {
    // Each test run creates a brand-new user, so there are no prior messages
    await expect(page.getByPlaceholder('Type a message...')).toBeVisible();
    await expect(page.getByText('Start a conversation')).toBeVisible();
    // Confirm we're using the isolated test email (not the old shared one)
    expect(testEmail).toMatch(/^test-w\d+-[0-9a-f]+@test\.local$/);
  });
});
