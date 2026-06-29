import { test, expect } from "@playwright/test";

/**
 * Meetings is REAL — title/date/summary/attendees come from the API, with an
 * honest empty state when there are none. No seed "Sprint Planning" content.
 */
const PROJECT = { id: "p1", name: "Demo", path: "/d", account_strategy: "round_robin", model_ceiling: null, autopilot: 0, created_at: "" };

test.describe("meetings (real)", () => {
  test("real meetings render list + detail", async ({ page }) => {
    await page.route("**/api/projects", (r) => r.fulfill({ json: { projects: [PROJECT] } }));
    await page.route("**/api/meetings**", (r) =>
      r.fulfill({ json: { meetings: [
        { id: "mtg-real-1", project_id: "p1", title: "Quarterly roadmap sync", date: "2026-04-01", summary: "Locked the Q2 roadmap and owners.", attendees: ["Sam", "Lee"], created_at: "" },
        { id: "mtg-real-2", project_id: "p1", title: "Architecture review", date: "2026-04-02", summary: "Picked the data layer.", attendees: ["Sam"], created_at: "" },
      ] } }),
    );
    await page.goto("/meetings");
    await expect(page.getByTestId("meetings")).toBeVisible();
    await expect(page.getByTestId("mtg-item")).toHaveCount(2);
    await expect(page.locator(".mtg-title")).toHaveText("Quarterly roadmap sync");
    await expect(page.getByTestId("mtg-detail")).toContainText("Locked the Q2 roadmap");
    await page.getByTestId("mtg-item").filter({ hasText: "Architecture review" }).click();
    await expect(page.locator(".mtg-title")).toHaveText("Architecture review");
    await expect(page.getByTestId("mtg-detail")).toContainText("Picked the data layer");
  });

  test("no meetings → honest empty state", async ({ page }) => {
    await page.route("**/api/projects", (r) => r.fulfill({ json: { projects: [PROJECT] } }));
    await page.route("**/api/meetings**", (r) => r.fulfill({ json: { meetings: [] } }));
    await page.goto("/meetings");
    await expect(page.getByText("No meetings captured yet.")).toBeVisible();
    await expect(page.getByTestId("meetings")).toHaveCount(0);
  });
});
