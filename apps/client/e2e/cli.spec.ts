import { test, expect } from "@playwright/test";

/**
 * V2 Phase 2 — CLI / logs: recent-runs sidebar ↔ colorized faux terminal. Seeded.
 */
test.describe("cli / logs", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/cli");
    await expect(page.getByTestId("cli")).toBeVisible();
  });

  test("recent runs select a log to render", async ({ page }) => {
    await expect(page.getByTestId("cli-run").first()).toBeVisible();
    await expect(page.getByTestId("cli-log")).toContainText("spade run --sprint");
    await page.getByTestId("cli-run").filter({ hasText: "brain export" }).click();
    await expect(page.getByTestId("cli-log")).toContainText("spade brain export --mcp");
  });

  test("log block renders colorized lines with a prompt", async ({ page }) => {
    const log = page.getByTestId("cli-log");
    await expect(log.locator(".term .tline")).not.toHaveCount(0);
    await expect(log.locator(".term")).toContainText("$");
    await expect(log.locator(".term")).toContainText("passed (212 tests");
  });
});
