import { test, expect } from './fixtures';

test.describe('Role Management', () => {
  test.describe.configure({ mode: 'serial' });

  test('sidebar shows the initial role after onboarding', async ({ authenticatedPage: page }) => {
    await expect(page.getByRole('button', { name: /test role/i }).first()).toBeVisible();
  });

  test('can open and close CreateRoleDialog without creating a role', async ({
    authenticatedPage: page,
  }) => {
    await page.getByTitle('Create role').click();
    await expect(page.getByRole('heading', { name: /create new role/i })).toBeVisible();

    // Cancel dismisses the dialog
    await page.getByRole('button', { name: /cancel/i }).click();
    await expect(page.getByRole('heading', { name: /create new role/i })).not.toBeVisible();
  });

  test('Escape key closes CreateRoleDialog', async ({ authenticatedPage: page }) => {
    await page.getByTitle('Create role').click();
    await expect(page.getByRole('heading', { name: /create new role/i })).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByRole('heading', { name: /create new role/i })).not.toBeVisible();
  });

  test('Create Role button is disabled when name is empty', async ({
    authenticatedPage: page,
  }) => {
    await page.getByTitle('Create role').click();
    await expect(
      page.getByRole('button', { name: 'Create Role', exact: true }),
    ).toBeDisabled();
    await page.keyboard.press('Escape');
  });

  test('can create a second role from the sidebar', async ({ authenticatedPage: page }) => {
    await page.getByTitle('Create role').click();
    await page.getByLabel(/role name/i).fill('Side Project');
    await page.getByRole('button', { name: 'Create Role', exact: true }).click();

    // Dialog closes and new role appears in the sidebar
    await expect(page.getByRole('heading', { name: /create new role/i })).not.toBeVisible();
    await expect(page.getByRole('button', { name: /side project/i }).first()).toBeVisible();
  });

  test('can switch between roles', async ({ authenticatedPage: page }) => {
    // Both roles should be present (created in prior serial test)
    await expect(page.getByRole('button', { name: /test role/i }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /side project/i }).first()).toBeVisible();

    // Click "Test Role" to switch
    await page.getByRole('button', { name: /test role/i }).first().click();
    // Chat input visible means the switch completed and app is responsive
    await expect(page.getByPlaceholder('Type a message...')).toBeVisible();
  });

  test('can open Role Description dialog and save a description', async ({
    authenticatedPage: page,
  }) => {
    // Expand the chevron for "Test Role"
    const roleRow = page.locator('div').filter({ hasText: /^test role$/ }).first();
    await page.getByTitle('Role options').first().click();

    // Click "Role Description" sub-menu item
    await page.getByRole('button', { name: /role description/i }).click();
    await expect(page.getByRole('heading', { name: /role description/i })).toBeVisible();

    // Clear and type a new description
    const textarea = page.getByPlaceholder(/describe your role/i);
    await textarea.clear();
    await textarea.fill('I manage software projects and need help with planning.');
    await page.getByRole('button', { name: /^save$/i }).click();

    // Dialog should close after saving
    await expect(page.getByRole('heading', { name: /role description/i })).not.toBeVisible();
  });

  test('Role Description dialog closes on Escape without saving', async ({
    authenticatedPage: page,
  }) => {
    await page.getByTitle('Role options').first().click();
    await page.getByRole('button', { name: /role description/i }).click();
    await expect(page.getByRole('heading', { name: /role description/i })).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByRole('heading', { name: /role description/i })).not.toBeVisible();
  });
});
