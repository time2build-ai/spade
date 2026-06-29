import { test, expect, type Page } from "@playwright/test";

/**
 * /sprints is REAL — hero + sprint rows come from /api/sprints (no DEMO_SPRINTS,
 * no burn-down SVG, no "acme/web-app"). The hero subtitle uses the project name;
 * empty projects get an honest "no sprints yet" state.
 */
const PROJECT = { id: "p1", name: "Demo", path: "/d", account_strategy: "round_robin", model_ceiling: null, autopilot: 0, created_at: "" };

async function mock(page: Page, sprints: object[]) {
  await page.route("**/api/projects", (r) => r.fulfill({ json: { projects: [PROJECT] } }));
  await page.route("**/api/sprints**", (r) => r.fulfill({ json: { sprints } }));
}

test.describe("sprints (real API)", () => {
  test("project with no sprints → honest empty state", async ({ page }) => {
    await mock(page, []);
    await page.goto("/sprints");
    await expect(page.getByTestId("sprints-empty")).toContainText("No sprints yet");
    await expect(page.getByTestId("sprint-hero")).toHaveCount(0);
    await expect(page.getByTestId("sprint-row")).toHaveCount(0);
  });

  test("real sprints render hero + rows + stacked bar", async ({ page }) => {
    await mock(page, [
      { id: "s30", project_id: "p1", number: 30, day_label: "day 3/10", state: "active", started_at: null, created_at: "", shipped: 5, review: 1, progress: 2, queued: 3, total: 11 },
      { id: "s29", project_id: "p1", number: 29, day_label: "day 10/10", state: "done", started_at: null, created_at: "", shipped: 9, review: 0, progress: 0, queued: 1, total: 10 },
    ]);
    await page.goto("/sprints");
    await expect(page.getByTestId("sprints-empty")).toHaveCount(0);

    // Hero: real current sprint number + project name (not "acme/web-app").
    const hero = page.getByTestId("sprint-hero");
    await expect(hero).toContainText("Sprint 30");
    await expect(hero).toContainText("Demo");
    await expect(hero).not.toContainText("acme/web-app");
    await expect(hero.getByTestId("stack-bar")).toBeVisible();
    await expect(hero.locator(".stack-bar > span")).not.toHaveCount(0);

    // Rows: one per real sprint, current one tagged.
    await expect(page.getByTestId("sprint-row")).toHaveCount(2);
    await expect(page.locator(".sprint-row.current")).toHaveCount(1);
    await expect(page.locator(".sprint-row.current")).toContainText("Sprint 30");
    await expect(page.locator(".sprint-row.current")).toContainText("current");
  });
});
