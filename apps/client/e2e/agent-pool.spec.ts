import { test, expect, type Page } from "@playwright/test";

/**
 * Agent pool — de-mocked. Provider glyph avatars (colored per real provider) +
 * an in-use state derived from real sessions. No fabricated usage meters /
 * always-on role pills / executions: the executions table lists the REAL fleet's
 * working sessions, with honest empty states. Mocks the API.
 */

const ACCOUNTS = [
  { id: "a1", label: "acct-claude", color: null, provider: "claude", config_dir: "~/.claude", is_default: 1, created_at: "" },
  { id: "a2", label: "acct-codex", color: null, provider: "codex", config_dir: "~/.codex", is_default: 0, created_at: "" },
];

const SESSION = {
  id: "sess1", name: "dev-1", alive: true, cmd: "claude", cwd: "/x", role: "developer", label: null,
  emoji: null, mode: null, prep: "working", prep_detail: null, task: "SPD-1", order: null, model: null,
  mission: null, parent: null, reason: null, state: "running", harness_state: null, has_menu: false,
  account_id: "a1", project_id: "p1",
};

async function mockPool(page: Page, sessions: unknown[] = [SESSION]) {
  await page.route("**/api/sessions", (r) => r.fulfill({ json: { sessions } }));
  await page.route("**/api/accounts", (r) => r.fulfill({ json: { accounts: ACCOUNTS } }));
}

test.describe("agent pool accounts", () => {
  test.beforeEach(async ({ page }) => {
    await mockPool(page);
    await page.goto("/agent-pool");
    await expect(page.locator(".acct-card").first()).toBeVisible();
  });

  test("account cards show the provider glyph avatar", async ({ page }) => {
    await expect(page.locator('.acct-card[data-provider="claude"] [data-testid="acct-glyph"]')).toHaveText("✦");
    await expect(page.locator('.acct-card[data-provider="codex"] [data-testid="acct-glyph"]')).toHaveText("◇");
  });

  test("an account with an alive session shows 'in use', others 'idle'", async ({ page }) => {
    const claude = page.locator('.acct-card[data-provider="claude"]');
    const codex = page.locator('.acct-card[data-provider="codex"]');
    await expect(claude.locator(".acct-state")).toHaveAttribute("data-state", "running");
    await expect(claude.locator(".acct-state")).toContainText("in use");
    await expect(codex.locator(".acct-state")).toHaveAttribute("data-state", "idle");
    await expect(codex.locator(".acct-state")).toContainText("idle");
  });

  test("no fabricated usage meter is rendered", async ({ page }) => {
    await expect(page.locator('[data-testid="acct-meter"]')).toHaveCount(0);
  });

  test("real account role/model show through when present", async ({ page }) => {
    await page.route("**/api/accounts", (r) =>
      r.fulfill({ json: { accounts: [{ ...ACCOUNTS[0], role: "Integrator", model: "claude-real-x", plan: "Enterprise" }, ACCOUNTS[1]] } }),
    );
    await page.goto("/agent-pool");
    const card = page.locator('.acct-card[data-provider="claude"]');
    await expect(card.getByTestId("acct-role")).toHaveText("Integrator");
    await expect(card.locator(".acct-sub")).toContainText("claude-real-x");
    await expect(card.locator(".acct-sub")).toContainText("Enterprise");
  });

  test("'Executions in progress' lists real working sessions", async ({ page }) => {
    const table = page.getByTestId("exec-table");
    await expect(table).toBeVisible();
    const row = table.getByTestId("exec-row").first();
    await expect(row).toContainText("dev-1");
    await expect(row).toContainText("SPD-1");
    await expect(row).toContainText("acct-claude");
  });

  test("no live executions shows an honest empty state", async ({ page }) => {
    await mockPool(page, []);
    await page.goto("/agent-pool");
    await expect(page.locator(".ap-executions")).toContainText("No executions in progress.");
    await expect(page.locator(".ap-pool")).toContainText("No agents running.");
  });
});
