import { test, expect, type Page } from "@playwright/test";

/**
 * V2 Phase 2 — Accounts (standalone): intro+stats, PM→worker graph, dispatch
 * strategy selector, provider-filter tabs, account cards, handoff log.
 */
const ACCOUNTS = [
  { id: "a1", label: "rmurphy@acme", color: null, provider: "claude", config_dir: "~/.claude", is_default: 1, created_at: "" },
  { id: "a2", label: "lab@acme", color: null, provider: "codex", config_dir: "~/.codex", is_default: 0, created_at: "" },
  { id: "a3", label: "dan@acme", color: null, provider: "claude", config_dir: "~/.claude2", is_default: 0, created_at: "" },
];

async function mock(page: Page) {
  await page.route("**/api/accounts", (r) => r.fulfill({ json: { accounts: ACCOUNTS } }));
  await page.route("**/api/sessions", (r) => r.fulfill({ json: { sessions: [] } }));
}

test.describe("accounts (standalone)", () => {
  test.beforeEach(async ({ page }) => {
    await mock(page);
    await page.goto("/accounts");
    await expect(page.locator(".acc-wrap")).toBeVisible();
  });

  test("intro + stats + PM→worker graph + handoff log", async ({ page }) => {
    await expect(page.locator(".acc-intro")).toBeVisible();
    await expect(page.locator(".acc-stats .acc-stat")).toHaveCount(3);
    await expect(page.getByTestId("orch-graph").locator("path")).not.toHaveCount(0);
    await expect(page.getByTestId("handoff-log").locator(".acc-handoff").first()).toBeVisible();
  });

  test("dispatch strategy selector is selectable", async ({ page }) => {
    const strats = page.getByTestId("acc-strat");
    await expect(strats).toHaveCount(4);
    await strats.nth(1).click();
    await expect(strats.nth(1)).toHaveClass(/on/);
  });

  test("provider tabs filter the account list", async ({ page }) => {
    // All 3 accounts initially.
    await expect(page.locator(".acct-list .acct-card")).toHaveCount(3);
    await page.getByTestId("provider-tabs").getByRole("button", { name: "codex" }).click();
    await expect(page.locator(".acct-list .acct-card")).toHaveCount(1);
    await page.getByTestId("provider-tabs").getByRole("button", { name: "all" }).click();
    await expect(page.locator(".acct-list .acct-card")).toHaveCount(3);
  });
});
