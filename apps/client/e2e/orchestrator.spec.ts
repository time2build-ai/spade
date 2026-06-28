import { test, expect, type Page } from "@playwright/test";

/**
 * PR-08 — Orchestrator pipeline table (reference inline-expanding layout).
 * No-fabrication: the table + detail show only real fields (task, title,
 * stages, account, status); the reference's Cost/ETA columns and fabricated
 * files/tokens/live-log cards are omitted (the expanded row embeds our REAL
 * session terminal instead). Mocks the API.
 */

const STAGES = [
  ["Developer", 0, "done", "a1"],
  ["Reviewer", 1, "running", "a1"],
  ["Integrator", 2, "queued", null],
  ["Documentor", 3, "queued", null],
].map(([role, order, state, account_id], i) => ({
  id: `s${i}`,
  pipeline_run_id: "pl1",
  role,
  stage_order: order,
  state,
  session_id: null,
  account_id,
  created_at: "",
}));

const RUNS = [
  // progress=73 is the backend-derived real value (Phase 3); it must win over the seed.
  { id: "pl1", project_id: "p1", task_id: "T-1", status: "running", current_stage: 1, created_at: "", stages: STAGES, progress: 73, stages_done: 1, stages_total: 4 },
];

const TASKS = [
  { id: "T-1", project_id: "p1", title: "Optimize mobile checkout", feature: "Checkout", priority: 0, status: "in_progress", origin_quote: null, origin_source: null, description: null, created_at: "", nodes: [], links: [] },
];

async function mockOrch(page: Page) {
  await page.route("**/api/projects", (r) =>
    r.fulfill({ json: { projects: [{ id: "p1", name: "Demo", path: "/demo", account_strategy: "round_robin", model_ceiling: null, autopilot: 0, created_at: "" }] } }),
  );
  await page.route("**/api/pipelines**", (r) => r.fulfill({ json: { pipelines: RUNS } }));
  await page.route("**/api/tasks**", (r) => r.fulfill({ json: { tasks: TASKS } }));
  await page.route("**/api/accounts", (r) => r.fulfill({ json: { accounts: [{ id: "a1", label: "acct-1", color: null, provider: "anthropic", config_dir: "", is_default: 1, created_at: "" }] } }));
}

test.describe("orchestrator table", () => {
  test.beforeEach(async ({ page }) => {
    await mockOrch(page);
    await page.goto("/orchestrator");
    await expect(page.getByTestId("orch-table")).toBeVisible();
  });

  test("renders a row with the joined task title, account and status", async ({ page }) => {
    const row = page.locator('[data-testid="orch-row"][data-run-id="pl1"]');
    await expect(row).toContainText("T-1");
    await expect(row).toContainText("Optimize mobile checkout");
    await expect(row).toContainText("acct-1");
    await expect(row).toContainText("running");
    await expect(row).toContainText("step 2/4");
  });

  test("clicking a row expands the real-stage detail", async ({ page }) => {
    await expect(page.getByTestId("orch-detail")).toHaveCount(0);
    await page.locator('[data-testid="orch-row"][data-run-id="pl1"]').click();
    const detail = page.getByTestId("orch-detail");
    await expect(detail).toBeVisible();
    await expect(detail.locator(".orch-d-stage")).toHaveCount(4);
    await expect(detail).toContainText("Developer");
    await expect(detail).toContainText("Reviewer");
  });

  test("the filter narrows the rows", async ({ page }) => {
    await expect(page.locator('[data-testid="orch-row"]')).toHaveCount(1);
    await page.locator(".seg button", { hasText: "Shipped" }).click();
    await expect(page.locator('[data-testid="orch-row"]')).toHaveCount(0);
    await page.locator(".seg button", { hasText: /^All/ }).click();
    await expect(page.locator('[data-testid="orch-row"]')).toHaveCount(1);
  });

  test("KPI strip has 6 cells with sub-lines", async ({ page }) => {
    await expect(page.locator(".orch-summary-strip .stat-cell")).toHaveCount(6);
    await expect(page.locator(".orch-summary-strip")).toContainText("Tokens · 24h");
    await expect(page.locator(".orch-summary-strip .stat-cell .sub").first()).toBeVisible();
  });

  test("table has Cost + ETA columns", async ({ page }) => {
    const heads = await page.locator(".orch-table .th").allTextContents();
    expect(heads).toContain("Cost");
    expect(heads).toContain("ETA");
  });

  test("expanded detail shows progress + context + files + animated live-log", async ({ page }) => {
    await page.locator('[data-testid="orch-row"][data-run-id="pl1"]').click();
    const detail = page.getByTestId("orch-detail");
    await expect(detail.locator(".orch-d-progress-bar .fill")).toBeVisible();
    await expect(detail).toContainText("Context");
    await expect(detail).toContainText("Files touched");
    await expect(detail.getByTestId("live-log")).toBeVisible();
    // The live-log streams in lines over time.
    await expect(detail.locator('[data-testid="live-log"] .tline')).not.toHaveCount(0);
  });

  test("real backend progress wins over the seed (Phase 3)", async ({ page }) => {
    await page.locator('[data-testid="orch-row"][data-run-id="pl1"]').click();
    const detail = page.getByTestId("orch-detail");
    await expect(detail.getByTestId("orch-progress-label")).toContainText("73%");
    await expect(detail.getByTestId("orch-progress-fill")).toHaveAttribute("style", /width:\s*73%/);
  });
});
