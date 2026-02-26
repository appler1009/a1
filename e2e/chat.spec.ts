import { test, expect } from './fixtures';

test.describe('Chat Interaction', () => {
  test('login page is accessible', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible();
    await expect(page.getByLabel(/email address/i)).toBeVisible();
  });

  test('app shows chat input when authenticated', async ({ authenticatedPage: page }) => {
    await expect(page.getByPlaceholder('Type a message...')).toBeVisible();
  });

  test('can fill and clear message input', async ({ authenticatedPage: page }) => {
    const input = page.getByPlaceholder('Type a message...');
    await input.fill('test message');
    await expect(input).toHaveValue('test message');
    await input.clear();
    await expect(input).toHaveValue('');
  });

  test('send button is present', async ({ authenticatedPage: page }) => {
    await expect(page.getByRole('button', { name: /send/i })).toBeVisible();
  });
});
