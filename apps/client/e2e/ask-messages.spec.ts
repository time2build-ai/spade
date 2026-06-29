import { test, expect, type Page } from "@playwright/test";

/**
 * PR-13 — Ask message anatomy (avatars + who-header + alignment).
 * No-fabrication: messages are the real chat (user prompt + orchestrator
 * response); only the bubble anatomy changes. Citation pills / plan / diff cards
 * (PR-16) stay deferred — the orchestrator doesn't emit that structure. Mocks
 * the API so a send round-trips without a backend.
 */

const ORCH = {
  id: "orch1", name: "orchestrator-p1", alive: true, cmd: "claude", cwd: "/x",
  role: "orchestrator", label: null, emoji: null, mode: null, prep: "ready",
  prep_detail: null, task: null, order: null, model: null, mission: null,
  parent: null, reason: null, state: "idle", harness_state: null, has_menu: false,
  account_id: "a1", project_id: "p1",
};

async function mockAsk(page: Page) {
  await page.route("**/api/projects", (r) =>
    r.fulfill({ json: { projects: [{ id: "p1", name: "Demo", path: "/demo", account_strategy: "round_robin", model_ceiling: null, autopilot: 0, created_at: "" }] } }),
  );
  await page.route("**/api/accounts", (r) => r.fulfill({ json: { accounts: [{ id: "a1", label: "acct-1", color: null, provider: "claude", config_dir: "", is_default: 1, created_at: "" }] } }));
  await page.route("**/api/sessions", (r) => r.fulfill({ json: { sessions: [ORCH] } }));
  await page.route("**/api/current-project", (r) => r.fulfill({ json: { project_id: "p1" } }));
  await page.route("**/api/sessions/*/prompt", (r) => r.fulfill({ json: { response: "Hello from the brain.", state: "idle" } }));
  // any other brain/tasks calls the page makes
  await page.route("**/api/brain/nodes**", (r) => r.fulfill({ json: { nodes: [] } }));
  await page.route("**/api/tasks**", (r) => r.fulfill({ json: { tasks: [] } }));
}

test.describe("ask message anatomy", () => {
  test.beforeEach(async ({ page }) => {
    await mockAsk(page);
    await page.goto("/backlog");
    await page.waitForLoadState("networkidle"); // let the client hydrate
    // Open the Ask dock from the topbar command pill (retry until it sticks —
    // the pill's onClick needs hydration).
    const pill = page.locator("header.topbar").getByText("Ask the brain…");
    await expect(async () => {
      await pill.click();
      await expect(page.getByPlaceholder(/Ask about this project/)).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 10_000 });
  });

  test("user and assistant messages render avatars and align opposite sides", async ({ page }) => {
    await page.getByPlaceholder(/Ask about this project/).fill("hi there");
    await page.getByTestId("ask-send").click();

    // Assistant reply round-trips via the mocked prompt endpoint.
    const brainRow = page.locator(".ch-msg.ch-assistant");
    await expect(brainRow).toContainText("Hello from the brain.");
    await expect(brainRow.getByTestId("ask-msg-avatar")).toBeVisible();

    const youRow = page.locator(".ch-msg.ch-user");
    await expect(youRow).toContainText("hi there");
    await expect(youRow.getByTestId("ask-msg-avatar")).toBeVisible();
  });

  test("user row is right-aligned, assistant row left-aligned", async ({ page }) => {
    await page.getByPlaceholder(/Ask about this project/).fill("hi");
    await page.getByTestId("ask-send").click();
    await expect(page.locator(".ch-msg.ch-assistant")).toContainText("Hello from the brain.");

    const you = (await page.locator(".ch-msg.ch-user").boundingBox())!;
    const brain = (await page.locator(".ch-msg.ch-assistant").boundingBox())!;
    // User row starts further right than the assistant row.
    expect(you.x).toBeGreaterThan(brain.x);
  });
});
