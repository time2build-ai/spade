import { test, expect } from "@playwright/test";

/**
 * PLAN-V2 Phase 0 PR-1 — shell modes.
 * `/` is the full-bleed home (sidebar hidden via body.home-mode); project routes
 * show the normal shell; /workspace/* applies workspace-level (lavender wash).
 */
test.describe("shell modes", () => {
  test("home route is full-bleed and hides the sidebar", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("body")).toHaveClass(/home-mode/);
    await expect(page.locator("body")).toHaveClass(/workspace-level/);
    await expect(page.getByTestId("home-root")).toBeVisible();
    await expect(page.locator("aside.sidebar")).toBeHidden();
  });

  test("a project route shows the normal shell (no mode classes)", async ({ page }) => {
    await page.goto("/backlog");
    await expect(page.locator("body")).not.toHaveClass(/home-mode/);
    await expect(page.locator("body")).not.toHaveClass(/workspace-level/);
    await expect(page.locator("aside.sidebar")).toBeVisible();
  });

  test("a workspace route applies workspace-level", async ({ page }) => {
    await page.goto("/workspace/settings");
    await expect(page.locator("body")).toHaveClass(/workspace-level/);
    await expect(page.locator("body")).not.toHaveClass(/home-mode/);
  });
});
