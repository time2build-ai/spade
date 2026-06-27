import { type Page, type Locator, expect } from "@playwright/test";

/**
 * Shared locators / helpers for parity specs. The shell (sidebar + topbar)
 * renders from static config in the layout, so these are data-independent and
 * safe to use even when the API at :8765 is down.
 */

export const sidebar = (page: Page): Locator => page.locator("aside.sidebar, aside").first();

/** A sidebar nav row by its visible label (items carry badges, so match by
 *  substring on the .sb-item, not exact text). */
export const navItem = (page: Page, label: string): Locator =>
  sidebar(page).locator(".sb-item", { hasText: label }).first();

/** Click a built (non-"#") sidebar item and wait for the route to settle. */
export async function gotoNav(page: Page, label: string): Promise<void> {
  await navItem(page, label).click();
  await page.waitForLoadState("networkidle");
}

/** Assert the shell chrome is present on the current page. */
export async function expectShell(page: Page): Promise<void> {
  await expect(sidebar(page)).toBeVisible();
}
