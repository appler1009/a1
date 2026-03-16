import { test, expect } from './fixtures';

// iPhone SE viewport
const MOBILE_VIEWPORT = { width: 375, height: 667 };

test.describe('Mobile layout', () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
  });

  test('sidebar opens and closes via hamburger button', async ({ authenticatedPage: page }) => {
    // On mobile, sidebar should be hidden initially
    const sidebar = page.locator('[class*="translate-x-full"]');
    await expect(sidebar).toBeVisible();

    // Open sidebar via hamburger
    await page.getByTitle('Open sidebar').click();
    await expect(page.locator('[class*="translate-x-0"]')).toBeVisible();

    // Backdrop should appear
    await expect(page.locator('.fixed.inset-0.bg-black\\/50')).toBeVisible();

    // Close by clicking backdrop
    await page.locator('.fixed.inset-0.bg-black\\/50').click();
    await expect(page.locator('[class*="translate-x-full"]')).toBeVisible();
  });

  test('Memory dialog appears above sidebar (not behind it)', async ({ authenticatedPage: page }) => {
    // Open sidebar
    await page.getByTitle('Open sidebar').click();
    await expect(page.locator('[class*="translate-x-0"]')).toBeVisible();

    // Expand first role's sub-menu
    await page.locator('button[title="Role options"]').first().click();

    // Click "View Memory"
    await page.getByRole('button', { name: /view memory/i }).click();

    // Sidebar should close
    await expect(page.locator('[class*="translate-x-full"]')).toBeVisible();

    // Memory dialog should be visible (heading includes "Memory")
    await expect(page.getByRole('heading', { name: /— memory$/i })).toBeVisible();
  });

  test('Role Description dialog appears above sidebar (not behind it)', async ({
    authenticatedPage: page,
  }) => {
    // Open sidebar
    await page.getByTitle('Open sidebar').click();
    await expect(page.locator('[class*="translate-x-0"]')).toBeVisible();

    // Expand first role's sub-menu
    await page.locator('button[title="Role options"]').first().click();

    // Click "Role Description"
    await page.getByRole('button', { name: /role description/i }).click();

    // Sidebar should close
    await expect(page.locator('[class*="translate-x-full"]')).toBeVisible();

    // Role Description dialog should be visible
    await expect(page.getByRole('heading', { name: /role description/i })).toBeVisible();
  });

  test('Scheduled Jobs dialog appears above sidebar (not behind it)', async ({
    authenticatedPage: page,
  }) => {
    // Open sidebar
    await page.getByTitle('Open sidebar').click();
    await expect(page.locator('[class*="translate-x-0"]')).toBeVisible();

    // Click Scheduled button
    await page.getByRole('button', { name: /scheduled/i }).click();

    // Sidebar should close
    await expect(page.locator('[class*="translate-x-full"]')).toBeVisible();

    // Scheduled Jobs dialog should be visible
    await expect(page.getByRole('heading', { name: /scheduled jobs/i })).toBeVisible();
  });

  test('Settings dialog appears above sidebar (not behind it)', async ({
    authenticatedPage: page,
  }) => {
    // Open sidebar
    await page.getByTitle('Open sidebar').click();
    await expect(page.locator('[class*="translate-x-0"]')).toBeVisible();

    // Click Settings button
    await page.getByTitle('Settings').click();

    // Sidebar should close
    await expect(page.locator('[class*="translate-x-full"]')).toBeVisible();

    // Settings dialog should be visible
    await expect(page.getByRole('heading', { name: /settings/i })).toBeVisible();
  });
});
