import { test, expect } from "@playwright/test";

/**
 * V2 Phase 2 — Overview: hero + headline metric/sparkline, KPI band, mini-charts,
 * "now executing" strip, and a 4-card summary grid. Seeded; project name wins.
 */
test.describe("overview", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/overview");
    await expect(page.getByTestId("ov-hero")).toBeVisible();
  });

  test("hero + KPI band render", async ({ page }) => {
    await expect(page.locator(".ov-hero-val")).toContainText("%");
    await expect(page.getByTestId("ov-hero").getByTestId("sparkline")).toBeVisible();
    await expect(page.getByTestId("ov-kpis").locator(".ov-kpi")).toHaveCount(4);
  });

  test("mini-charts + now-executing strip", async ({ page }) => {
    await expect(page.getByTestId("ov-charts").locator(".ov-chart")).toHaveCount(3);
    await expect(page.getByTestId("ov-now").locator(".ov-now-row")).toHaveCount(3);
  });

  test("summary card grid", async ({ page }) => {
    await expect(page.getByTestId("ov-card")).toHaveCount(4);
    await expect(page.getByTestId("ov-grid")).toContainText("Recent decisions");
  });
});
