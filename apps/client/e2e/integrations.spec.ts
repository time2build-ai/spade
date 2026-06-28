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

  test("a connection toggle flips (seed)", async ({ page }) => {
    const toggle = page.getByLabel("Slack connection");
    await expect(toggle).toHaveAttribute("aria-checked", "false"); // off by default
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
  });
});

test.describe("integrations (real API)", () => {
  test("real integrations render and the toggle PATCHes (Phase 3)", async ({ page }) => {
    let patched: { url: string; body: unknown } | null = null;
    await page.route("**/api/projects", (r) =>
      r.fulfill({ json: { projects: [{ id: "p1", name: "Demo", path: "/d", account_strategy: "round_robin", model_ceiling: null, autopilot: 0, created_at: "" }] } }),
    );
    await page.route("**/api/integrations**", (r) =>
      r.fulfill({ json: { integrations: [
        { id: "i1", project_id: "p1", name: "Notion", category: "Docs", status: "off", usage: "12 pages synced", connected: 0, created_at: "" },
      ] } }),
    );
    // Registered last → wins for the specific PATCH URL.
    await page.route("**/api/integrations/i1", async (route) => {
      patched = { url: route.request().url(), body: route.request().postDataJSON() };
      await route.fulfill({ json: { id: "i1", project_id: "p1", name: "Notion", category: "Docs", status: "connected", usage: "x", connected: 1, created_at: "" } });
    });
    await page.goto("/integrations");
    await expect(page.getByTestId("int-card")).toHaveCount(1);
    await expect(page.getByTestId("integrations")).toContainText("Notion");
    await expect(page.getByTestId("integrations")).toContainText("12 pages synced");

    const toggle = page.getByLabel("Notion connection");
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await toggle.click();
    await expect.poll(() => patched).not.toBeNull();
    expect(patched!.body).toEqual({ connected: true });
  });
});
