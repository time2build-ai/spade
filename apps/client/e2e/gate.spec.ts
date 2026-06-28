import { test, expect, type Page } from "@playwright/test";

/**
 * V2 Phase 2 — Gate conflict screen: banner + actions, Task/Why cards, 2-panel
 * conflict, diff snippet, 3 signal cards, reviewer suggestion. Hydrates the task
 * card from a real brake when present; conflict narrative is seeded.
 */
async function mock(page: Page, brakes: unknown[] = []) {
  await page.route("**/api/brakes", (r) => r.fulfill({ json: { brakes } }));
}

test.describe("gate conflict screen", () => {
  test("renders the bespoke conflict screen (seeded)", async ({ page }) => {
    await mock(page);
    await page.goto("/gate");
    const screen = page.getByTestId("gate-conflict");
    await expect(screen).toBeVisible();
    await expect(screen).toContainText("Reviewer paused this pipeline");
    await expect(screen.getByRole("button", { name: /Approve & resume/ })).toBeVisible();
    // 2-panel conflict + diff + 3 signal cards.
    await expect(screen.locator(".conflict .panel")).toHaveCount(2);
    await expect(page.getByTestId("gate-diff").locator(".add").first()).toBeVisible();
    await expect(page.getByTestId("signal-card")).toHaveCount(3);
    await expect(screen).toContainText("Reviewer suggests");
  });

  test("hydrates the task card from a real brake", async ({ page }) => {
    await mock(page, [
      { id: "b1", mission: "SPD-200 · Ship the new pricing page", brake: "review", detail: "wants a human call before merge.", worker: "sess_xyz" },
    ]);
    await page.goto("/gate");
    await expect(page.getByTestId("gate-conflict")).toContainText("SPD-200 · Ship the new pricing page");
    await expect(page.getByTestId("gate-conflict")).toContainText("sess_xyz");
  });
});
