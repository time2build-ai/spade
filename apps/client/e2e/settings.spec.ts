import { test, expect, type Page } from "@playwright/test";

/**
 * V2 Phase 2 — Settings: grouped per-project automation toggle rows. Autopilot
 * reads the real project field; the rest is seeded. Toggles are local state.
 */
async function mock(page: Page) {
  await page.route("**/api/projects", (r) =>
    r.fulfill({
      json: { projects: [{ id: "p1", name: "Acme Storefront", path: "acme/web", account_strategy: "round_robin", model_ceiling: "opus", autopilot: 1, created_at: "" }] },
    }),
  );
}

test.describe("settings", () => {
  test.beforeEach(async ({ page }) => {
    await mock(page);
    await page.goto("/settings");
    await expect(page.getByTestId("settings")).toBeVisible();
  });

  test("renders grouped toggle rows + shows the real strategy/ceiling", async ({ page }) => {
    await expect(page.getByTestId("set-group")).toHaveCount(4);
    await expect(page.getByTestId("set-row").first()).toBeVisible();
    await expect(page.getByTestId("settings")).toContainText("round_robin");
    await expect(page.getByTestId("settings")).toContainText("opus");
  });

  test("autopilot reflects the real project field and toggles", async ({ page }) => {
    const autopilotRow = page.getByTestId("set-row").filter({ hasText: "Autopilot" });
    const toggle = autopilotRow.getByRole("switch");
    await expect(toggle).toHaveAttribute("aria-checked", "true"); // project.autopilot === 1
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "false");
  });
});
