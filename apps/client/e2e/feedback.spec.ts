import { test, expect } from "@playwright/test";

/**
 * V2 Phase 2 — Feedback: cluster list ↔ detail (source-breakdown bar, platform
 * pills, verbatim quote cards). Seeded.
 */
test.describe("feedback", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/feedback");
    await expect(page.getByTestId("feedback")).toBeVisible();
  });

  test("cluster list selects a cluster", async ({ page }) => {
    await expect(page.getByTestId("fb-cluster").first()).toBeVisible();
    await expect(page.locator(".fb-title")).toContainText("Checkout slow on mobile");
    await page.getByTestId("fb-cluster").filter({ hasText: "random" }).click();
    await expect(page.locator(".fb-title")).toContainText("Recommendations feel random");
  });

  test("detail has a source bar, platform pills, and quote cards", async ({ page }) => {
    const d = page.getByTestId("fb-detail");
    await expect(d.getByTestId("src-bar").locator("span")).not.toHaveCount(0);
    await expect(d.locator(".fb-platform").first()).toBeVisible();
    await expect(d.getByTestId("quote-card").first()).toBeVisible();
  });
});
