import { test, expect } from './fixtures';

test.describe('Settings Dialog', () => {
  test('opens when clicking the Settings button in the sidebar', async ({
    authenticatedPage: page,
  }) => {
    await page.getByTitle('Settings').click();
    await expect(page.getByRole('heading', { name: /settings/i })).toBeVisible();
  });

  test('closes when clicking the X button', async ({ authenticatedPage: page }) => {
    await page.getByTitle('Settings').click();
    await expect(page.getByRole('heading', { name: /settings/i })).toBeVisible();

    await page.getByRole('button', { name: '✕' }).click();
    await expect(page.getByRole('heading', { name: /settings/i })).not.toBeVisible();
  });

  test('closes on Escape key', async ({ authenticatedPage: page }) => {
    await page.getByTitle('Settings').click();
    await expect(page.getByRole('heading', { name: /settings/i })).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByRole('heading', { name: /settings/i })).not.toBeVisible();
  });

  test('shows all expected tabs', async ({ authenticatedPage: page }) => {
    await page.getByTitle('Settings').click();

    for (const tab of ['Account', 'Billing', 'Models', 'Features', 'Region', 'Bots', 'About']) {
      await expect(page.getByRole('button', { name: new RegExp(`^${tab}$`, 'i') }).first()).toBeVisible();
    }
  });

  test('Account tab — primary role selector has no "No default" option', async ({
    authenticatedPage: page,
  }) => {
    await page.getByTitle('Settings').click();
    await page.getByRole('button', { name: /^account$/i }).click();

    const select = page.locator('select');
    const options = await select.locator('option').allTextContents();
    expect(options).not.toContain('No default');
  });

  test('Account tab — primary role selector pre-selects a role', async ({
    authenticatedPage: page,
  }) => {
    await page.getByTitle('Settings').click();
    await page.getByRole('button', { name: /^account$/i }).click();

    const select = page.locator('select');
    const value = await select.inputValue();
    expect(value).not.toBe('');
  });
});
