/**
 * Mobile E2E tests — iPhone SE emulation (375×667, touch, Safari UA).
 *
 * Uses the `mobileAuthenticatedPage` fixture which creates a browser context
 * via Playwright's built-in `devices['iPhone SE']`, giving us the correct
 * viewport, deviceScaleFactor, touch support, and user-agent automatically.
 */
import { test, expect } from './fixtures';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Open the sidebar by tapping the hamburger button. */
async function openSidebar(page: import('@playwright/test').Page) {
  await page.getByTitle('Open sidebar').click();
  // Wait until the sidebar's "Create role" button enters the viewport
  await expect(page.getByTitle('Create role')).toBeInViewport();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Mobile layout — iPhone SE', () => {
  test('shows hamburger button; sidebar is off-screen initially', async ({
    mobileAuthenticatedPage: page,
  }) => {
    await expect(page.getByTitle('Open sidebar')).toBeVisible();
    // Sidebar's "Create role" button exists in DOM but must not be in viewport
    await expect(page.getByTitle('Create role')).not.toBeInViewport();
  });

  test('chat input and send button are visible without scrolling', async ({
    mobileAuthenticatedPage: page,
  }) => {
    await expect(page.getByPlaceholder('Type a message...')).toBeInViewport();
    await expect(page.getByRole('button', { name: /send/i })).toBeInViewport();
  });

  test('sidebar opens via hamburger and shows role list', async ({
    mobileAuthenticatedPage: page,
  }) => {
    await openSidebar(page);
    await expect(page.getByRole('button', { name: /test role/i }).first()).toBeInViewport();
    // Backdrop overlay should appear
    await expect(page.getByTestId('mobile-sidebar-backdrop')).toBeVisible();
  });

  test('sidebar closes by tapping the backdrop', async ({
    mobileAuthenticatedPage: page,
  }) => {
    await openSidebar(page);
    // Dispatch click on backdrop via JS — avoids z-index hit-test issues in Playwright
    await page.getByTestId('mobile-sidebar-backdrop').dispatchEvent('click');
    await expect(page.getByTitle('Create role')).not.toBeInViewport();
  });

  test('switching role closes the sidebar', async ({
    mobileAuthenticatedPage: page,
  }) => {
    await openSidebar(page);
    await page.getByRole('button', { name: /test role/i }).first().click();
    // After switching, sidebar should slide away
    await expect(page.getByTitle('Create role')).not.toBeInViewport();
    // Chat input is back in view
    await expect(page.getByPlaceholder('Type a message...')).toBeInViewport();
  });

  test('Settings dialog opens full-screen and sidebar closes', async ({
    mobileAuthenticatedPage: page,
  }) => {
    await openSidebar(page);
    await page.getByTitle('Settings').click();

    // Sidebar should close
    await expect(page.getByTitle('Create role')).not.toBeInViewport();

    // Dialog heading is visible
    const heading = page.getByRole('heading', { name: /settings/i });
    await expect(heading).toBeVisible();

    // Dialog fills the viewport (full-screen on mobile)
    const viewport = page.viewportSize()!;
    const box = await heading.locator('xpath=ancestor::div[contains(@class,"bg-background")]').first().boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(viewport.width * 0.9);
    expect(box!.height).toBeGreaterThan(viewport.height * 0.9);
  });

  test('Scheduled Jobs dialog opens full-screen and sidebar closes', async ({
    mobileAuthenticatedPage: page,
  }) => {
    await openSidebar(page);
    await page.getByRole('button', { name: /scheduled/i }).click();

    await expect(page.getByTitle('Create role')).not.toBeInViewport();

    const heading = page.getByRole('heading', { name: /scheduled jobs/i });
    await expect(heading).toBeVisible();

    const viewport = page.viewportSize()!;
    const box = await heading.locator('xpath=ancestor::div[contains(@class,"bg-card")]').first().boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(viewport.width * 0.9);
    expect(box!.height).toBeGreaterThan(viewport.height * 0.9);
  });

  test('Memory dialog opens full-screen and sidebar closes', async ({
    mobileAuthenticatedPage: page,
  }) => {
    await openSidebar(page);
    await page.locator('button[title="Role options"]').first().click();
    await page.getByRole('button', { name: /view memory/i }).click();

    await expect(page.getByTitle('Create role')).not.toBeInViewport();

    const heading = page.getByRole('heading', { name: /— memory$/i });
    await expect(heading).toBeVisible();

    const viewport = page.viewportSize()!;
    const box = await heading.locator('xpath=ancestor::div[contains(@class,"bg-card")]').first().boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(viewport.width * 0.9);
    expect(box!.height).toBeGreaterThan(viewport.height * 0.9);
  });

  test('Role Description dialog opens full-screen and sidebar closes', async ({
    mobileAuthenticatedPage: page,
  }) => {
    await openSidebar(page);
    await page.locator('button[title="Role options"]').first().click();
    await page.getByRole('button', { name: /role description/i }).click();

    await expect(page.getByTitle('Create role')).not.toBeInViewport();

    const heading = page.getByRole('heading', { name: /role description/i });
    await expect(heading).toBeVisible();

    const viewport = page.viewportSize()!;
    const box = await heading.locator('xpath=ancestor::div[contains(@class,"bg-card")]').first().boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(viewport.width * 0.9);
    expect(box!.height).toBeGreaterThan(viewport.height * 0.9);
  });

  test('can create a role on mobile', async ({
    mobileAuthenticatedPage: page,
  }) => {
    await openSidebar(page);
    await page.getByTitle('Create role').click();

    // Dialog is full-screen — heading should be visible
    await expect(page.getByRole('heading', { name: /create new role/i })).toBeVisible();

    await page.getByLabel(/role name/i).fill('Mobile Role');
    await page.getByRole('button', { name: 'Create Role', exact: true }).click();

    // Dialog closes; sidebar stays open after role creation — new role visible directly
    await expect(page.getByRole('heading', { name: /create new role/i })).not.toBeVisible();
    await expect(page.getByRole('button', { name: /mobile role/i }).first()).toBeInViewport();
  });

  test('Settings tab bar is horizontally scrollable', async ({
    mobileAuthenticatedPage: page,
  }) => {
    await openSidebar(page);
    await page.getByTitle('Settings').click();
    await expect(page.getByRole('heading', { name: /settings/i })).toBeVisible();

    // The tab bar container must have scrollable overflow
    const isScrollable = await page.evaluate(() => {
      const tabBar = document.querySelector('[class*="overflow-x-auto"]');
      return tabBar ? tabBar.scrollWidth > tabBar.clientWidth : false;
    });
    expect(isScrollable).toBe(true);
  });
});
