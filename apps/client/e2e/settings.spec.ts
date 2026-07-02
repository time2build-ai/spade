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
  await page.route("**/api/projects/*/git", (r) => {
    if (r.request().method() === "GET") {
      return r.fulfill({ json: { project_id: "p1", repo_ssh_url: "git@github.com:acme/web.git", dev_branch: "development", staging_branch: "staging", prod_branch: "main", worktrees_root: null, created_at: "" } });
    }
    return r.fulfill({ json: {} });
  });
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

  test("toggling autopilot PATCHes the project (Phase 3 — persists)", async ({ page }) => {
    let patched: { url: string; body: unknown } | null = null;
    await page.route("**/api/projects/p1", async (route) => {
      patched = { url: route.request().url(), body: route.request().postDataJSON() };
      await route.fulfill({ json: { id: "p1", name: "Acme Storefront", path: "acme/web", account_strategy: "round_robin", model_ceiling: "opus", autopilot: 0, created_at: "" } });
    });
    const toggle = page.getByTestId("set-row").filter({ hasText: "Autopilot" }).getByRole("switch");
    await toggle.click(); // 1 → 0
    await expect.poll(() => patched).not.toBeNull();
    expect(patched!.url).toContain("/api/projects/p1");
    expect(patched!.body).toEqual({ autopilot: 0 });
  });

  test("the groups fill the full width (grid, not a narrow column)", async ({ page }) => {
    const groups = page.locator(".set-groups");
    await expect(groups).toBeVisible();
    const box = (await groups.boundingBox())!;
    // spans most of the content area (>1000px on the desktop viewport), not capped at 760
    expect(box.width).toBeGreaterThan(1000);
  });

  test("danger zone deletes the project and returns home", async ({ page }) => {
    let deleted = false;
    await page.route("**/api/projects/p1", async (route) => {
      if (route.request().method() === "DELETE") {
        deleted = true;
        await route.fulfill({ json: { id: "p1", status: "deleted" } });
      } else {
        await route.fulfill({ json: { id: "p1", name: "Acme Storefront", path: "acme/web", account_strategy: "round_robin", model_ceiling: "opus", autopilot: 1, created_at: "" } });
      }
    });
    await expect(page.getByTestId("set-danger")).toContainText("Delete this project");
    await page.getByTestId("delete-project").click();
    // requires an explicit confirm (no accidental delete)
    const confirm = page.getByTestId("confirm-delete");
    await expect(confirm).toBeVisible();
    await confirm.click();
    await expect.poll(() => deleted).toBe(true);
    await expect(page).toHaveURL(/\/$/); // back to home
  });
});
