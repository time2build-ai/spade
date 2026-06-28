import { test, expect, type Page } from "@playwright/test";

/**
 * Topbar: a REAL current-sprint pill (from /sprints, hidden when the project has
 * none) and the active account label — no fabricated usage %. Sprint pill hides
 * at workspace level.
 */

const topbar = (page: Page) => page.locator("header.topbar");

const PROJECT = { id: "p1", name: "Demo", path: "/d", account_strategy: "round_robin", model_ceiling: null, autopilot: 0, created_at: "" };
const sprint = (number: number, day: string) => ({ id: "s1", project_id: "p1", number, day_label: day, state: "active", started_at: null, created_at: "", shipped: 0, review: 0, progress: 0, queued: 0, total: 0 });

test.describe("topbar (full parity)", () => {
  test("tweaks button is a borderless ghost button", async ({ page }) => {
    await page.goto("/backlog");
    const tweaks = topbar(page).getByRole("button", { name: "Toggle tweaks panel" });
    const cls = (await tweaks.getAttribute("class")) ?? "";
    expect(cls.split(/\s+/)).toEqual(expect.arrayContaining(["btn", "ghost"]));
    expect(cls).not.toContain("icon-btn");
  });

  test("real sprint pill is shown on a project route, hidden at workspace level", async ({ page }) => {
    await page.route("**/api/projects", (r) => r.fulfill({ json: { projects: [PROJECT] } }));
    await page.route("**/api/sprints**", (r) => r.fulfill({ json: { sprints: [sprint(7, "day 2/10")] } }));
    await page.goto("/backlog");
    await expect(topbar(page).locator(".topbar-sprint")).toHaveText(/sprint 7 · day 2\/10/);
    await page.goto("/workspace/settings");
    await expect(topbar(page).locator(".topbar-sprint")).toBeHidden();
  });

  test("no sprint pill when the project has no sprint", async ({ page }) => {
    await page.route("**/api/projects", (r) => r.fulfill({ json: { projects: [PROJECT] } }));
    await page.route("**/api/sprints**", (r) => r.fulfill({ json: { sprints: [] } }));
    await page.goto("/backlog");
    await expect(topbar(page)).toBeVisible();
    await expect(topbar(page).locator(".topbar-sprint")).toHaveCount(0);
  });

  test("account pill shows the real account label, no fabricated usage %", async ({ page }) => {
    await page.route("**/api/accounts", (r) =>
      r.fulfill({
        json: {
          accounts: [
            { id: "a1", label: "rmurphy@acme", color: null, provider: "claude", config_dir: "", is_default: 1, created_at: "" },
          ],
        },
      }),
    );
    await page.goto("/backlog");
    await expect(topbar(page).getByText(/acct: rmurphy@acme/)).toBeVisible();
    await expect(topbar(page).getByText(/%/)).toHaveCount(0); // no seeded usage %
  });

  test("daemon pill counts only ALIVE sessions", async ({ page }) => {
    await page.route("**/api/sessions", (r) =>
      r.fulfill({
        json: {
          sessions: [
            { id: "s1", alive: true, name: "a", cmd: "", cwd: "", role: null, label: null, emoji: null, mode: null, prep: null, prep_detail: null, task: null, order: null, model: null, mission: null, parent: null, reason: null, state: "", harness_state: null, has_menu: false, account_id: null, project_id: null },
            { id: "s2", alive: false, name: "b", cmd: "", cwd: "", role: null, label: null, emoji: null, mode: null, prep: null, prep_detail: null, task: null, order: null, model: null, mission: null, parent: null, reason: null, state: "", harness_state: null, has_menu: false, account_id: null, project_id: null },
          ],
        },
      }),
    );
    await page.goto("/backlog");
    await expect(topbar(page).getByText(/daemon · 1 sessions/)).toBeVisible();
  });
});
