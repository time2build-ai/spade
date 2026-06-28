import { test, expect } from "@playwright/test";

/**
 * V2 Phase 2 — Integrations: connection cards grouped by category, each with a
 * status dot, usage line, and a connect toggle. Seeded.
 */
test.describe("integrations", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/integrations");
    await expect(page.getByTestId("integrations")).toBeVisible();
  });

  test("groups + connection cards with status + usage", async ({ page }) => {
    await expect(page.getByTestId("int-group")).not.toHaveCount(0);
    const card = page.getByTestId("int-card").first();
    await expect(card).toBeVisible();
    await expect(card.locator(".int-status-dot")).toBeVisible();
    await expect(card.locator(".int-usage")).toBeVisible();
    await expect(page.getByTestId("integrations")).toContainText("GitHub");
  });

  test("a connection toggle flips", async ({ page }) => {
    const toggle = page.getByLabel("Slack connection");
    await expect(toggle).toHaveAttribute("aria-checked", "false"); // off by default
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
  });
});
