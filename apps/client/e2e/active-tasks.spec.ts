import { test, expect, type Page } from "@playwright/test";

/**
 * PR-09 — Active tasks route.
 * Shows live (non-shipped) pipelines as cards with a progress rail derived from
 * completed/total stages, expandable stage detail, and an Open→task link.
 * No-fabrication: progress is real (done/total), status is the real run status;
 * eta/spent/tokens omitted. Mocks the API.
 */

const STAGES = [
  ["Developer", "done", "a1"],
  ["Reviewer", "running", "a1"],
  ["Integrator", "queued", null],
  ["Documentor", "queued", null],
].map(([role, state, account_id], i) => ({
  id: `s${i}`, pipeline_run_id: "pl1", role, stage_order: i, state, session_id: null, account_id, created_at: "",
}));

const RUNS = [
  { id: "pl1", project_id: "p1", task_id: "T-1", status: "running", current_stage: 1, created_at: "", stages: STAGES },
  { id: "pl2", project_id: "p1", task_id: "T-2", status: "shipped", current_stage: 3, created_at: "", stages: [] },
];

const TASKS = [
  { id: "T-1", project_id: "p1", title: "Optimize mobile checkout", feature: "Checkout", priority: 0, status: "in_progress", origin_quote: null, origin_source: null, description: null, created_at: "", nodes: [], links: [] },
];

async function mockActive(page: Page) {
  await page.route("**/api/projects", (r) =>
    r.fulfill({ json: { projects: [{ id: "p1", name: "Demo", path: "/demo", account_strategy: "round_robin", model_ceiling: null, autopilot: 0, created_at: "" }] } }),
  );
  await page.route("**/api/pipelines**", (r) => r.fulfill({ json: { pipelines: RUNS } }));
  await page.route("**/api/tasks**", (r) => r.fulfill({ json: { tasks: TASKS } }));
  await page.route("**/api/accounts", (r) => r.fulfill({ json: { accounts: [{ id: "a1", label: "acct-1", color: null, provider: "anthropic", config_dir: "", is_default: 1, created_at: "" }] } }));
}

test.describe("active tasks", () => {
  test.beforeEach(async ({ page }) => {
    await mockActive(page);
    await page.goto("/active");
    await expect(page.getByTestId("active-list")).toBeVisible();
  });

  test("lists only live (non-shipped) pipelines", async ({ page }) => {
    // pl1 running shows; pl2 shipped does not.
    await expect(page.locator('[data-testid="active-card"]')).toHaveCount(1);
    const card = page.locator('[data-testid="active-card"][data-run-id="pl1"]');
    await expect(card).toContainText("T-1");
    await expect(card).toContainText("Optimize mobile checkout");
    await expect(card).toContainText("acct-1");
    await expect(card).toContainText("running");
  });

  test("progress rail reflects completed stages (1/4)", async ({ page }) => {
    const card = page.locator('[data-testid="active-card"][data-run-id="pl1"]');
    await expect(card).toContainText("1/4");
    await expect(card.locator(".progress-rail .fill")).toHaveAttribute("style", /width:\s*25%/);
  });

  test("expanding shows the real stage roles", async ({ page }) => {
    const card = page.locator('[data-testid="active-card"][data-run-id="pl1"]');
    await card.locator(".ac-head").click();
    await expect(card.locator(".ac-stage-mini")).toHaveCount(4);
    await expect(card).toContainText("Developer");
    await expect(card).toContainText("Reviewer");
  });

  test("Open links to the task detail", async ({ page }) => {
    const card = page.locator('[data-testid="active-card"][data-run-id="pl1"]');
    await expect(card.getByRole("link", { name: "Open", exact: true })).toHaveAttribute("href", "/task/T-1");
  });
});
