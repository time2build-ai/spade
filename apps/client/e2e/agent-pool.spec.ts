import { test, expect, type Page } from "@playwright/test";

/**
 * PR-10 — Agent Pool account cards (honest subset).
 * Provider glyph avatars (colored per real account.provider) + an in-use state
 * derived from real sessions (session.account_id of an alive session).
 * No-fabrication: no usage meters / role pills / % / executions table (no API
 * data for those). Mocks the API.
 */

const ACCOUNTS = [
  { id: "a1", label: "acct-claude", color: null, provider: "claude", config_dir: "~/.claude", is_default: 1, created_at: "" },
  { id: "a2", label: "acct-codex", color: null, provider: "codex", config_dir: "~/.codex", is_default: 0, created_at: "" },
];

const SESSION = {
  id: "sess1", name: "dev", alive: true, cmd: "claude", cwd: "/x", role: "Developer", label: null,
  emoji: null, mode: null, prep: null, prep_detail: null, task: null, order: null, model: null,
  mission: null, parent: null, reason: null, state: "idle", harness_state: null, has_menu: false,
  account_id: "a1", project_id: "p1",
};

async function mockPool(page: Page) {
  await page.route("**/api/sessions", (r) => r.fulfill({ json: { sessions: [SESSION] } }));
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

  test("rich account card shows a role pill, usage meter, and model·plan", async ({ page }) => {
    const card = page.locator(".acct-card.rich").first();
    await expect(card.getByTestId("acct-role")).toBeVisible();
    await expect(card.getByTestId("acct-meter").locator(".fill")).toBeVisible();
    await expect(card.locator(".acct-sub")).toContainText("·"); // model · plan
  });

  test("'Executions in progress' table lists AI-ISS rows with node chips", async ({ page }) => {
    const table = page.getByTestId("exec-table");
    await expect(table).toBeVisible();
    await expect(table.getByTestId("exec-row").first()).toBeVisible();
    await expect(table).toContainText("AI-ISS-241");
    await expect(table.locator(".node-chip").first()).toBeVisible();
  });
});
