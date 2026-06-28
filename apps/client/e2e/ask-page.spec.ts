import { test, expect } from "@playwright/test";

/**
 * V2 Phase 1 — full /ask page: thread list (search + pinned/recent), chat panel
 * with rich messages (cites / plan / ADR-EDIT diff cards), context rail. Seeded.
 */
test.describe("ask page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/ask");
    await expect(page.getByTestId("ask-page")).toBeVisible();
  });

  test("thread list with search + pinned/recent groups", async ({ page }) => {
    await expect(page.locator(".ask-threads-group", { hasText: "Pinned" })).toBeVisible();
    await expect(page.locator(".ask-threads-group", { hasText: "Recent" })).toBeVisible();
    await expect(page.getByTestId("ask-thread").first()).toBeVisible();
    // Search narrows the list.
    await page.locator(".ask-threads-search input").fill("conversion");
    await expect(page.getByTestId("ask-thread")).toHaveCount(1);
  });

  test("selecting a thread loads its messages", async ({ page }) => {
    await page.getByTestId("ask-thread").filter({ hasText: "Sprint 26 standup" }).click();
    await expect(page.locator(".ch-title")).toHaveText("Sprint 26 standup summary");
    await expect(page.locator(".ch-stream .ch-msg").first()).toBeVisible();
  });

  test("rich messages render a plan card and an ADR-EDIT diff card", async ({ page }) => {
    // th-1 (default) has the ADR-EDIT action; th-2 has the plan.
    await expect(page.getByTestId("ch-action").first()).toBeVisible();
    await expect(page.getByTestId("ch-action")).toContainText("ADR-EDIT");
    await expect(page.locator(".ch-diff-line.add").first()).toBeVisible();
    await page.getByTestId("ask-thread").filter({ hasText: "conversion" }).click();
    await expect(page.getByTestId("ch-plan")).toBeVisible();
    await expect(page.locator(".ch-cite").first()).toBeVisible();
  });

  test("context rail shows project + model", async ({ page }) => {
    const rail = page.locator(".ask-rail");
    await expect(rail).toContainText("Project");
    await expect(rail).toContainText("claude-opus-4");
  });
});
