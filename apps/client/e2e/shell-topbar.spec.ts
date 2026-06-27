import { test, expect, type Page } from "@playwright/test";

/**
 * V2 PR-3 — topbar parity: the sprint pill + account usage % are now SHOWN
 * (seeded; the no-fabrication omissions were reversed). Sprint pill hides at
 * workspace level.
 */

const topbar = (page: Page) => page.locator("header.topbar");

test.describe("topbar (full parity)", () => {
  test("tweaks button is a borderless ghost button", async ({ page }) => {
    await page.goto("/backlog");
    const tweaks = topbar(page).getByRole("button", { name: "Toggle tweaks panel" });
    const cls = (await tweaks.getAttribute("class")) ?? "";
    expect(cls.split(/\s+/)).toEqual(expect.arrayContaining(["btn", "ghost"]));
    expect(cls).not.toContain("icon-btn");
  });

  test("sprint pill is shown on a project route, hidden at workspace level", async ({ page }) => {
    await page.goto("/backlog");
    await expect(topbar(page).locator(".topbar-sprint")).toHaveText(/sprint 26 · day 2\/10/);
    await page.goto("/workspace/settings");
    await expect(topbar(page).locator(".topbar-sprint")).toBeHidden();
  });

  test("account pill shows acct: prefix + usage %", async ({ page }) => {
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
    await expect(topbar(page).getByText(/acct: rmurphy@acme · 62%/)).toBeVisible();
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
