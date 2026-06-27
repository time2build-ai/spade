import { test, expect, type Page } from "@playwright/test";

/**
 * PR-14 — Ask dock relocation: a persistent bottom-right trigger pill (reference
 * launcher) and the dock docked bottom-right (was top-center). No-fabrication:
 * pure positioning/UI. The reference's separate ⌘K right-edge SIDE-dock (vs the
 * bubble) is noted deferred — we keep one float + trigger. Mocks the API.
 */

async function mockShell(page: Page) {
  await page.route("**/api/projects", (r) =>
    r.fulfill({ json: { projects: [{ id: "p1", name: "Demo", path: "/demo", account_strategy: "round_robin", model_ceiling: null, autopilot: 0, created_at: "" }] } }),
  );
  await page.route("**/api/accounts", (r) => r.fulfill({ json: { accounts: [{ id: "a1", label: "acct-1", color: null, provider: "claude", config_dir: "", is_default: 1, created_at: "" }] } }));
}

test.describe("ask dock relocation", () => {
  test.beforeEach(async ({ page }) => {
    await mockShell(page);
    await page.goto("/backlog");
    await page.waitForLoadState("networkidle");
  });

  test("shows a bottom-right trigger pill when closed", async ({ page }) => {
    const trigger = page.getByTestId("ask-trigger");
    await expect(trigger).toBeVisible();
    const box = (await trigger.boundingBox())!;
    const vw = page.viewportSize()!.width;
    const vh = page.viewportSize()!.height;
    expect(box.x + box.width).toBeGreaterThan(vw - 60); // near right edge
    expect(box.y + box.height).toBeGreaterThan(vh - 60); // near bottom edge
  });

  test("clicking the trigger opens the dock bottom-right; trigger disappears", async ({ page }) => {
    await page.getByTestId("ask-trigger").click();
    const float = page.locator(".ask-float");
    await expect(float).toBeVisible();
    await expect(page.getByTestId("ask-trigger")).toHaveCount(0);

    const box = (await float.boundingBox())!;
    const vw = page.viewportSize()!.width;
    const vh = page.viewportSize()!.height;
    expect(box.x + box.width).toBeGreaterThan(vw - 60); // docked right
    expect(box.y + box.height).toBeGreaterThan(vh / 2); // lower half
  });

  test("⌘K toggles the dock", async ({ page }) => {
    await expect(page.getByTestId("ask-trigger")).toBeVisible();
    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.locator(".ask-float")).toBeVisible();
    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.locator(".ask-float")).toHaveCount(0);
    await expect(page.getByTestId("ask-trigger")).toBeVisible();
  });
});
