import { test, expect, type Page } from "@playwright/test";

/**
 * Accounts (standalone) — de-mocked: intro+stats, PM→worker graph, real-strategy
 * indicator, provider-filter tabs, real account cards, honest empty handoff log.
 * No seeded strategies/handoffs.
 */
const ACCOUNTS = [
  { id: "a1", label: "primary", color: null, provider: "claude", config_dir: "~/.claude", is_default: 1, created_at: "" },
  { id: "a2", label: "secondary", color: null, provider: "codex", config_dir: "~/.codex", is_default: 0, created_at: "" },
  { id: "a3", label: "tertiary", color: null, provider: "claude", config_dir: "~/.claude2", is_default: 0, created_at: "" },
];

const PROJECTS = [
  { id: "p1", name: "Demo", path: "/demo", account_strategy: "cost_aware", model_ceiling: null, autopilot: 0, created_at: "" },
];

async function mock(page: Page) {
  await page.route("**/api/projects", (r) => r.fulfill({ json: { projects: PROJECTS } }));
  await page.route("**/api/accounts", (r) => r.fulfill({ json: { accounts: ACCOUNTS } }));
  await page.route("**/api/sessions", (r) => r.fulfill({ json: { sessions: [] } }));
}

test.describe("accounts (standalone)", () => {
  test.beforeEach(async ({ page }) => {
    await mock(page);
    await page.goto("/accounts");
    await expect(page.locator(".acc-wrap")).toBeVisible();
  });

  test("intro + stats + PM→worker graph + honest empty handoff log", async ({ page }) => {
    await expect(page.locator(".acc-intro")).toBeVisible();
    await expect(page.locator(".acc-stats .acc-stat")).toHaveCount(3);
    await expect(page.getByTestId("orch-graph").locator("path")).not.toHaveCount(0);
    await expect(page.getByTestId("handoff-log")).toContainText("No handoffs recorded yet.");
  });

  test("dispatch strategy reflects the project's real account_strategy", async ({ page }) => {
    const strats = page.getByTestId("acc-strat");
    await expect(strats).toHaveCount(4);
    // The project strategy is cost_aware → that card is active; nothing toggles.
    await expect(page.locator('[data-testid="acc-strat"][data-active="true"]')).toContainText("Cost-aware");
  });

  test("provider tabs filter the account list", async ({ page }) => {
    await expect(page.locator(".acct-list .acct-card")).toHaveCount(3);
    await page.getByTestId("provider-tabs").getByRole("button", { name: "codex" }).click();
    await expect(page.locator(".acct-list .acct-card")).toHaveCount(1);
    await page.getByTestId("provider-tabs").getByRole("button", { name: "all" }).click();
    await expect(page.locator(".acct-list .acct-card")).toHaveCount(3);
  });

  test("empty pool shows an honest empty state", async ({ page }) => {
    await page.route("**/api/accounts", (r) => r.fulfill({ json: { accounts: [] } }));
    await page.goto("/accounts");
    await expect(page.locator(".acct-list")).toContainText("No accounts connected yet.");
  });
});
