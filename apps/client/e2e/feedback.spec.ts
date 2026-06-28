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

test.describe("feedback (real API)", () => {
  test("real clusters win over the seed (Phase 3)", async ({ page }) => {
    await page.route("**/api/projects", (r) =>
      r.fulfill({ json: { projects: [{ id: "p1", name: "Demo", path: "/d", account_strategy: "round_robin", model_ceiling: null, autopilot: 0, created_at: "" }] } }),
    );
    await page.route("**/api/feedback**", (r) =>
      r.fulfill({ json: { clusters: [
        { id: "fc-real-1", project_id: "p1", label: "Search returns nothing", count: 17, sources: [{ name: "Zendesk", n: 12, color: "var(--blue)" }, { name: "GitHub", n: 5, color: "#9aa0aa" }], created_at: "" },
      ] } }),
    );
    await page.goto("/feedback");
    await expect(page.getByTestId("feedback")).toBeVisible();
    await expect(page.getByTestId("fb-cluster")).toHaveCount(1);
    await expect(page.locator(".fb-title")).toHaveText("Search returns nothing");
    await expect(page.getByTestId("fb-detail")).toContainText("17 reports");
    await expect(page.getByTestId("fb-detail")).toContainText("Zendesk"); // real source pill
    await expect(page.getByTestId("fb-detail").getByTestId("quote-card").first()).toBeVisible(); // seeded
  });
});
