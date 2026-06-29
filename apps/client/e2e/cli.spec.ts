import { test, expect, type Page } from "@playwright/test";

/**
 * CLI / logs is REAL — live agent sessions are the runs; selecting one streams
 * its live terminal screen. No sessions → honest empty state. No seeded runs.
 */
const SESSIONS = [
  { id: "s1", name: "orchestrator-p1", alive: true, cmd: "claude", cwd: "/d", role: "orchestrator", label: "Orchestrator", emoji: null, mode: null, prep: "ready", prep_detail: null, task: null, order: 0, model: null, mission: null, parent: null, reason: null, state: "ready", harness_state: null, has_menu: false, account_id: null, project_id: "p1" },
  { id: "s2", name: "dev-p1", alive: true, cmd: "claude", cwd: "/d", role: "developer", label: "Developer", emoji: null, mode: null, prep: "working", prep_detail: null, task: null, order: 1, model: null, mission: null, parent: null, reason: null, state: "working", harness_state: null, has_menu: false, account_id: null, project_id: "p1" },
];

async function mockSessions(page: Page, sessions: unknown[]) {
  await page.route("**/api/sessions", (r) => r.fulfill({ json: { sessions } }));
}

test.describe("cli / logs (real)", () => {
  test("no sessions → honest empty state", async ({ page }) => {
    await mockSessions(page, []);
    await page.goto("/cli");
    await expect(page.locator("body")).toContainText("No live sessions right now.");
    await expect(page.getByTestId("cli")).toHaveCount(0);
  });

  test("live sessions select a screen to render", async ({ page }) => {
    await mockSessions(page, SESSIONS);
    await page.route("**/api/sessions/s1/screen", (r) => r.fulfill({ body: "orchestrator ready\n> waiting for prompt" }));
    await page.route("**/api/sessions/s2/screen", (r) => r.fulfill({ body: "developer working\n> editing files" }));
    await page.goto("/cli");
    await expect(page.getByTestId("cli")).toBeVisible();
    await expect(page.getByTestId("cli-run").first()).toBeVisible();
    await expect(page.getByTestId("cli-log")).toContainText("orchestrator ready");
    await page.getByTestId("cli-run").filter({ hasText: "Developer" }).click();
    await expect(page.getByTestId("cli-log")).toContainText("developer working");
  });

  test("no screen output yet → honest message", async ({ page }) => {
    await mockSessions(page, SESSIONS);
    await page.route("**/api/sessions/*/screen", (r) => r.fulfill({ body: "" }));
    await page.goto("/cli");
    await expect(page.getByTestId("cli-log")).toContainText("No log output yet.");
  });
});
