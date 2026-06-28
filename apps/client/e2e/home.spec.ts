import { test, expect, type Page } from "@playwright/test";

/**
 * V2 Phase 2 — Home dashboard: full-bleed (sidebar hidden), triage feed,
 * KPI band, sortable projects health table. Seeded; real project list wins.
 */
async function mock(page: Page) {
  await page.route("**/api/projects", (r) =>
    r.fulfill({
      json: {
        projects: [
          { id: "p1", name: "Acme Storefront", path: "acme/web", account_strategy: "round_robin", model_ceiling: null, autopilot: 0, created_at: "" },
          { id: "p2", name: "Beta App", path: "beta/app", account_strategy: "round_robin", model_ceiling: null, autopilot: 0, created_at: "" },
        ],
      },
    }),
  );
}

test.describe("home dashboard", () => {
  test.beforeEach(async ({ page }) => {
    await mock(page);
    await page.goto("/");
    await expect(page.getByTestId("home-root")).toBeVisible();
  });

  test("is full-bleed (sidebar hidden)", async ({ page }) => {
    await expect(page.locator("body")).toHaveClass(/home-mode/);
    await expect(page.locator("aside.sidebar")).toBeHidden();
  });

  test("KPI band + triage feed render", async ({ page }) => {
    await expect(page.getByTestId("home-kpis").locator(".home-kpi")).toHaveCount(5);
    await expect(page.getByTestId("triage-feed").getByTestId("tri-item")).toHaveCount(13);
  });

  test("projects table lists projects and is sortable", async ({ page }) => {
    const rows = page.getByTestId("projects-table").getByTestId("proj-row");
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText("sprint");
    // Sorting by a column keeps the rows rendered.
    await page.getByTestId("projects-table").getByRole("button", { name: "Brain" }).click();
    await expect(rows).toHaveCount(2);
  });
});
