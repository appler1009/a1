import { test, expect } from './fixtures';

test.describe('Chat Interaction', () => {
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

  test('send button is disabled when input is empty', async ({ authenticatedPage: page }) => {
    const input = page.getByPlaceholder('Type a message...');
    await expect(input).toHaveValue('');
    await expect(page.getByRole('button', { name: /send/i })).toBeDisabled();
  });

  test('send button enables when message is typed', async ({ authenticatedPage: page }) => {
    await page.getByPlaceholder('Type a message...').fill('hello');
    await expect(page.getByRole('button', { name: /send/i })).toBeEnabled();
  });

  test('sent message appears in the chat', async ({ authenticatedPage: page }) => {
    const input = page.getByPlaceholder('Type a message...');
    await input.fill('What is 2 + 2?');
    await page.getByRole('button', { name: /send/i }).click();

    // The user message should appear in the chat immediately (before AI responds)
    await expect(page.getByText('What is 2 + 2?')).toBeVisible({ timeout: 5000 });
  });

  test('input clears after sending a message', async ({ authenticatedPage: page }) => {
    const input = page.getByPlaceholder('Type a message...');
    await input.fill('Hello assistant');
    await page.getByRole('button', { name: /send/i }).click();

    // Input should empty out after the message is submitted
    await expect(input).toHaveValue('', { timeout: 5000 });
  });

  test('pressing Enter sends the message', async ({ authenticatedPage: page }) => {
    const input = page.getByPlaceholder('Type a message...');
    await input.fill('Testing Enter key');
    await input.press('Enter');

    await expect(page.getByText('Testing Enter key')).toBeVisible({ timeout: 5000 });
    await expect(input).toHaveValue('', { timeout: 5000 });
  });
});
