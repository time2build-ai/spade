import { test, expect } from "@playwright/test";

/**
 * Integrations is REAL — connection cards come from the API, grouped by category,
 * each with a status dot, usage line and a connect toggle that PATCHes. Honest
 * empty state when none are connected. No seed "GitHub/Slack" content.
 */
const PROJECT = { id: "p1", name: "Demo", path: "/d", account_strategy: "round_robin", model_ceiling: null, autopilot: 0, created_at: "" };

test.describe("integrations (real)", () => {
  test("real integrations render + toggle PATCHes", async ({ page }) => {
    let patched: { url: string; body: unknown } | null = null;
    await page.route("**/api/projects", (r) => r.fulfill({ json: { projects: [PROJECT] } }));
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
    await expect(page.getByTestId("int-group")).not.toHaveCount(0);
    await expect(page.getByTestId("int-card")).toHaveCount(1);
    await expect(page.getByTestId("integrations")).toContainText("Notion");
    await expect(page.getByTestId("integrations")).toContainText("12 pages synced");
    await expect(page.getByTestId("int-card").first().locator(".int-status-dot")).toBeVisible();

    const toggle = page.getByLabel("Notion connection");
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await expect.poll(() => patched).not.toBeNull();
    expect(patched!.body).toEqual({ connected: true });
  });

  test("no integrations → honest empty state", async ({ page }) => {
    await page.route("**/api/projects", (r) => r.fulfill({ json: { projects: [PROJECT] } }));
    await page.route("**/api/integrations**", (r) => r.fulfill({ json: { integrations: [] } }));
    await page.goto("/integrations");
    await expect(page.getByText("No integrations connected yet.")).toBeVisible();
    await expect(page.getByTestId("integrations")).toHaveCount(0);
  });
});
