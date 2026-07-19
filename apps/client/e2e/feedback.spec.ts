import { test, expect } from "@playwright/test";

/**
 * Feedback is REAL — label/count/sources drive the list, source bar and platform
 * pills, with an honest empty state when there are none. No seed "Checkout slow"
 * content.
 */
const PROJECT = { id: "p1", name: "Demo", path: "/d", account_strategy: "round_robin", model_ceiling: null, autopilot: 0, created_at: "" };

test.describe("feedback (real)", () => {
  test("real clusters render list + source breakdown", async ({ page }) => {
    await page.route("**/api/projects", (r) => r.fulfill({ json: { projects: [PROJECT] } }));
    await page.route("**/api/feedback**", (r) =>
      r.fulfill({ json: { clusters: [
        { id: "fc-real-1", project_id: "p1", label: "Search returns nothing", count: 17, sources: [{ name: "Zendesk", n: 12, color: "var(--blue)" }, { name: "GitHub", n: 5, color: "#9aa0aa" }], created_at: "" },
        { id: "fc-real-2", project_id: "p1", label: "Login times out", count: 4, sources: [], created_at: "" },
      ] } }),
    );
    await page.goto("/feedback");
    await expect(page.getByTestId("feedback")).toBeVisible();
    await expect(page.getByTestId("fb-cluster")).toHaveCount(2);
    await expect(page.locator(".fb-title")).toHaveText("Search returns nothing");
    await expect(page.getByTestId("fb-detail")).toContainText("17 reports");
    await expect(page.getByTestId("fb-detail")).toContainText("Zendesk");
    await expect(page.getByTestId("src-bar").locator("span")).not.toHaveCount(0);
    await page.getByTestId("fb-cluster").filter({ hasText: "Login" }).click();
    await expect(page.locator(".fb-title")).toHaveText("Login times out");
    await expect(page.getByTestId("fb-detail")).toContainText("No sources recorded.");
  });

  test("no clusters → honest empty state", async ({ page }) => {
    await page.route("**/api/projects", (r) => r.fulfill({ json: { projects: [PROJECT] } }));
    await page.route("**/api/feedback**", (r) => r.fulfill({ json: { clusters: [] } }));
    await page.goto("/feedback");
    await expect(page.getByText("No feedback yet")).toBeVisible();
    await expect(page.getByTestId("feedback")).toHaveCount(0);
  });
});
