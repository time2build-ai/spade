import { test, expect } from "@playwright/test";

/**
 * V2 Phase 2 — Sprints: current-sprint hero + stacked progress bar, a burn-down
 * SVG, and sprint rows (current + past). Seeded.
 */
test.describe("sprints", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/sprints");
    await expect(page.getByTestId("sprint-hero")).toBeVisible();
  });

  test("hero with stacked bar + stats", async ({ page }) => {
    await expect(page.getByTestId("sprint-hero")).toContainText("Sprint 26");
    await expect(page.getByTestId("sprint-hero").getByTestId("stack-bar")).toBeVisible();
    await expect(page.getByTestId("sprint-hero").locator(".stack-bar > span")).not.toHaveCount(0);
  });

  test("burn-down svg renders", async ({ page }) => {
    await expect(page.getByTestId("burn-svg")).toBeVisible();
    await expect(page.getByTestId("burn-svg").locator("path")).toHaveCount(2); // remaining + ideal
  });

  test("sprint rows incl. the current one", async ({ page }) => {
    await expect(page.getByTestId("sprint-row")).toHaveCount(4);
    await expect(page.locator(".sprint-row.current")).toHaveCount(1);
    await expect(page.locator(".sprint-row.current")).toContainText("current");
  });
});
