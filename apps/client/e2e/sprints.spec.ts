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

  test("sprint rows incl. the current one (seed fallback when no real rows)", async ({ page }) => {
    await expect(page.getByTestId("sprint-row")).toHaveCount(4);
    await expect(page.locator(".sprint-row.current")).toHaveCount(1);
    await expect(page.locator(".sprint-row.current")).toContainText("current");
  });
});

test.describe("sprints (real API)", () => {
  test("real sprint rows win over the seed (Phase 3)", async ({ page }) => {
    await page.route("**/api/projects", (r) =>
      r.fulfill({ json: { projects: [{ id: "p1", name: "Demo", path: "/d", account_strategy: "round_robin", model_ceiling: null, autopilot: 0, created_at: "" }] } }),
    );
    await page.route("**/api/sprints**", (r) =>
      r.fulfill({ json: { sprints: [
        { id: "s30", project_id: "p1", number: 30, day_label: "day 3/10", state: "active", started_at: null, created_at: "", shipped: 5, review: 1, progress: 2, queued: 3, total: 11 },
        { id: "s29", project_id: "p1", number: 29, day_label: "day 10/10", state: "done", started_at: null, created_at: "", shipped: 9, review: 0, progress: 0, queued: 1, total: 10 },
      ] } }),
    );
    await page.goto("/sprints");
    await expect(page.getByTestId("sprint-hero")).toContainText("Sprint 30"); // real number, not seed 26
    await expect(page.getByTestId("sprint-row")).toHaveCount(2); // 2 real rows, not 4 seeded
    await expect(page.locator(".sprint-row.current")).toContainText("Sprint 30");
  });
});
