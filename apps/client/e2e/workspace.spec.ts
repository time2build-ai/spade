import { test, expect } from "@playwright/test";

/**
 * V2 Phase 2 (final) — Workspace hub: workspace-level shell hosting links to the
 * global areas (settings / accounts / integrations / cli) + stats.
 */
test.describe("workspace", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/workspace");
    await expect(page.getByTestId("workspace")).toBeVisible();
  });

  test("is workspace-level (lavender wash) with the ws-only sidebar groups", async ({ page }) => {
    await expect(page.locator("body")).toHaveClass(/workspace-level/);
    const wsLabels = await page.locator("aside.sidebar .ws-only .sb-label").allTextContents();
    expect(wsLabels).toEqual(["Workspace", "Projects"]);
  });

  test("hosts cards linking to the global areas", async ({ page }) => {
    await expect(page.getByTestId("ws-card")).toHaveCount(4);
    await expect(page.getByTestId("ws-card").filter({ hasText: "Settings" })).toHaveAttribute("href", "/settings");
    await expect(page.getByTestId("ws-card").filter({ hasText: "Integrations" })).toHaveAttribute("href", "/integrations");
    await expect(page.getByTestId("ws-card").filter({ hasText: "Agents pool" })).toHaveAttribute("href", "/accounts");
  });
});
