import { test, expect, type Page } from "@playwright/test";

/**
 * ChatBubble (reference): a bottom-right accent pill that expands into a floating
 * bubble on click, and ⌘K opens it as a right-edge side dock. Mocks the API.
 */
async function mockShell(page: Page) {
  await page.route("**/api/projects", (r) =>
    r.fulfill({ json: { projects: [{ id: "p1", name: "Demo", path: "/demo", account_strategy: "round_robin", model_ceiling: null, autopilot: 0, created_at: "" }] } }),
  );
  await page.route("**/api/accounts", (r) => r.fulfill({ json: { accounts: [{ id: "a1", label: "acct-1", color: null, provider: "claude", config_dir: "", is_default: 1, created_at: "" }] } }));
}

test.describe("ask chat bubble", () => {
  test.beforeEach(async ({ page }) => {
    await mockShell(page);
    await page.goto("/backlog");
    await page.waitForLoadState("networkidle");
  });

  test("shows a bottom-right trigger pill when closed", async ({ page }) => {
    const trigger = page.getByTestId("ask-trigger");
    await expect(trigger).toBeVisible();
    await expect(trigger).toHaveText(/Ask/);
    const box = (await trigger.boundingBox())!;
    const vw = page.viewportSize()!.width;
    const vh = page.viewportSize()!.height;
    expect(box.x + box.width).toBeGreaterThan(vw - 60); // near right edge
    expect(box.y + box.height).toBeGreaterThan(vh - 60); // near bottom edge
  });

  test("clicking the trigger opens the bottom-right bubble; trigger disappears", async ({ page }) => {
    await page.getByTestId("ask-trigger").click();
    const bubble = page.locator(".ch-bubble-panel");
    await expect(bubble).toBeVisible();
    await expect(page.getByTestId("ask-trigger")).toHaveCount(0);
    // 440-wide bubble docked bottom-right
    const box = (await bubble.boundingBox())!;
    const vw = page.viewportSize()!.width;
    expect(box.x + box.width).toBeGreaterThan(vw - 60);
    // header has the thread picker + action icons
    await expect(bubble.locator(".ch-bub-thread-pick")).toBeVisible();
    await expect(bubble.locator(".ch-bub-actions .icon-btn")).toHaveCount(4);
  });

  test("⌘K opens the right-edge side dock; Esc closes", async ({ page }) => {
    await expect(page.getByTestId("ask-trigger")).toBeVisible();
    await page.keyboard.press("ControlOrMeta+k");
    const dock = page.locator(".ch-dock");
    await expect(dock).toBeVisible();
    // a full-height right-edge panel (~480 wide) with the dim overlay
    const box = (await dock.boundingBox())!;
    const vh = page.viewportSize()!.height;
    expect(box.height).toBeGreaterThan(vh - 4);
    await expect(page.locator(".ch-dock-overlay")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(".ch-dock")).toHaveCount(0);
    await expect(page.getByTestId("ask-trigger")).toBeVisible();
  });

  test("the bubble can dock to the side", async ({ page }) => {
    await page.getByTestId("ask-trigger").click();
    await page.locator(".ch-bubble-panel .icon-btn[title='Dock to side']").click();
    await expect(page.locator(".ch-dock")).toBeVisible();
    await expect(page.locator(".ch-bubble-panel")).toHaveCount(0);
  });
});
