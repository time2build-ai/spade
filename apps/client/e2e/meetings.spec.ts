import { test, expect } from "@playwright/test";

/**
 * V2 Phase 2 — Meetings: list ↔ detail (summary + key outcomes + transcript
 * with highlighted evidence lines). Seeded.
 */
test.describe("meetings", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/meetings");
    await expect(page.getByTestId("meetings")).toBeVisible();
  });

  test("list selects a meeting and loads its detail", async ({ page }) => {
    await expect(page.getByTestId("mtg-item").first()).toBeVisible();
    await expect(page.locator(".mtg-title")).toContainText("Sprint Planning");
    await page.getByTestId("mtg-item").filter({ hasText: "Architecture review" }).click();
    await expect(page.locator(".mtg-title")).toContainText("Architecture review");
  });

  test("detail has summary, key outcomes, and highlighted transcript", async ({ page }) => {
    const d = page.getByTestId("mtg-detail");
    await expect(d).toContainText("Summary");
    await expect(d.getByTestId("mtg-outcome").first()).toBeVisible();
    await expect(d).toContainText("Transcript");
    await expect(d.getByTestId("mtg-hl").first()).toBeVisible(); // highlighted evidence line
  });
});
