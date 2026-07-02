import { test, expect, type Page } from "@playwright/test";

/**
 * Backlog — Task Lifecycle V2.
 * Six columns (ready · shaping · plan_review · building · pr_review · shipped;
 * blocked routed to an amber banner, not a column), the blocked banner, the
 * "Run sprint" head action, and the amber "waiting on you" gate cards driven by
 * the lifecycle gate list. Mocks the API.
 */

const TASKS = [
  ["T-1", "ready", "Ready task"],
  ["T-2", "building", "WIP task"],
  ["T-3", "pr_review", "Review task"],
  ["T-4", "shipped", "Shipped task"],
  ["T-5", "blocked", "Blocked task"],
].map(([id, status, title]) => ({
  id,
  project_id: "p1",
  title,
  feature: "Checkout",
  priority: 1,
  status,
  origin_quote: null,
  origin_source: null,
  description: null,
  created_at: "2026-01-01T00:00:00Z",
  nodes: id === "T-1" ? ["bn-f", "bn-b", "bn-d"] : [],
  links: [],
}));

const BRAIN_NODES = [
  { id: "bn-f", project_id: "p1", type: "feedback", label: "slow checkout", detail: null, x: null, y: null, created_at: null },
  { id: "bn-b", project_id: "p1", type: "bug", label: "carousel jank", detail: null, x: null, y: null, created_at: null },
  { id: "bn-d", project_id: "p1", type: "decision", label: "use stripe", detail: null, x: null, y: null, created_at: null },
];

// One waiting gate on the still-building T-2 (its manual_test gate home), and a
// shipped run for T-4 that reached dev + staging → env badges.
const GATES = [
  { id: "g1", task_id: "T-2", run_id: "r2", gate: "manual_test", status: "waiting", comment: null, decided_by: null, decided_at: null, created_at: "", task_title: "WIP task", phase: "building" },
];
const RUNS = [
  { id: "r2", project_id: "p1", task_id: "T-2", phase: "building", active: 1, branch_name: null, worktree_path: null, pr_number: null, pr_url: null, merge_commit: null, env_dev_at: null, env_staging_at: null, env_prod_at: null, agent_session_id: null, account_id: null, blocked_reason: null, blocked_from_phase: null, self_heal_attempts: 0, last_finished_session: null, created_at: "2026-01-02", updated_at: "2026-01-02" },
  { id: "r4", project_id: "p1", task_id: "T-4", phase: "shipped", active: 0, branch_name: null, worktree_path: null, pr_number: 7, pr_url: null, merge_commit: "abc123", env_dev_at: "2026-01-03", env_staging_at: "2026-01-04", env_prod_at: null, agent_session_id: null, account_id: null, blocked_reason: null, blocked_from_phase: null, self_heal_attempts: 0, last_finished_session: null, created_at: "2026-01-02", updated_at: "2026-01-04" },
];

async function mockBacklog(page: Page) {
  await page.route("**/api/projects", (r) =>
    r.fulfill({
      json: {
        projects: [
          { id: "p1", name: "Demo", path: "/demo", account_strategy: "round_robin", model_ceiling: null, autopilot: 0, created_at: "" },
        ],
      },
    }),
  );
  await page.route("**/api/tasks**", (r) => r.fulfill({ json: { tasks: TASKS } }));
  await page.route("**/api/brain/nodes**", (r) => r.fulfill({ json: { nodes: BRAIN_NODES } }));
  await page.route("**/api/projects/*/gates", (r) => r.fulfill({ json: { gates: GATES } }));
  await page.route("**/api/lifecycle**", (r) => r.fulfill({ json: { runs: RUNS } }));
}

test.describe("backlog", () => {
  test.beforeEach(async ({ page }) => {
    await mockBacklog(page);
    await page.goto("/backlog");
    await expect(page.locator(".backlog-grid")).toBeVisible();
  });

  test("renders exactly 6 lifecycle columns, no Blocked column", async ({ page }) => {
    await expect(page.locator(".backlog-grid .col")).toHaveCount(6);
    for (const label of ["Ready", "Shaping", "Plan review", "Building", "PR review", "Shipped"]) {
      await expect(page.locator(".col-head", { hasText: label })).toHaveCount(1);
    }
    await expect(page.locator(".col-head", { hasText: "Blocked" })).toHaveCount(0);
  });

  test("blocked tasks surface in the amber banner with a gate link", async ({ page }) => {
    const banner = page.getByTestId("blocked-banner");
    await expect(banner).toBeVisible();
    await expect(banner).toContainText("T-5");
    await expect(banner.getByRole("link", { name: /Open gate/ })).toHaveAttribute("href", "/gate");
  });

  test("the blocked task is not placed in any column", async ({ page }) => {
    await expect(page.locator(".backlog-grid").getByText("Blocked task")).toHaveCount(0);
  });

  test('"Run sprint" head action links to the orchestrator', async ({ page }) => {
    await expect(page.getByRole("link", { name: /Run sprint/ })).toHaveAttribute("href", "/orchestrator");
  });

  test("populated columns show their task count", async ({ page }) => {
    for (const label of ["Ready", "Building", "PR review", "Shipped"]) {
      const head = page.locator(".col-head", { hasText: label });
      await expect(head.locator(".count")).toHaveText("1");
    }
  });

  test("card foot shows the building pill when status is building", async ({ page }) => {
    await expect(page.locator('[data-testid="task-card"] .tc-foot .avatar')).toHaveCount(0);
    const wip = page.locator('[data-testid="task-card"]', { hasText: "WIP task" });
    await expect(wip.locator(".tc-foot")).toContainText("building");
    const ready = page.locator('[data-testid="task-card"]', { hasText: "Ready task" });
    await expect(ready.locator(".tc-foot")).toContainText("ready");
  });

  test("a task with a waiting gate shows the amber 'waiting on you' card + Review link", async ({ page }) => {
    const wip = page.locator('[data-testid="task-card"]', { hasText: "WIP task" });
    const review = wip.getByTestId("card-gate-review");
    await expect(review).toBeVisible();
    await expect(review).toContainText("Review");
    await expect(wip).toContainText("waiting on you");
  });

  test("a shipped card shows env badges for the envs its run reached", async ({ page }) => {
    const shipped = page.locator('[data-testid="task-card"]', { hasText: "Shipped task" });
    await expect(shipped.getByTestId("env-badge-dev")).toBeVisible();
    await expect(shipped.getByTestId("env-badge-staging")).toBeVisible();
    // prod not reached → no prod badge.
    await expect(shipped.getByTestId("env-badge-prod")).toHaveCount(0);
  });

  test("rich card shows intel chips from linked nodes with reference wording", async ({ page }) => {
    const card = page.locator('[data-testid="task-card"]', { hasText: "Ready task" });
    await expect(card.locator(".intel-bar")).toBeVisible();
    await expect(card.locator(".chip.feedback")).toContainText("1 feedback");
    await expect(card.locator(".chip.bug")).toContainText("1 bug");
    await expect(card.locator(".chip.decision")).toContainText("1 ADR"); // "ADR" not "decision"
  });

  test("blocked banner surfaces the real blocked task + a gate link (no fabricated ADR)", async ({ page }) => {
    const banner = page.getByTestId("blocked-banner");
    await expect(banner).toContainText("Blocked task");
    await expect(banner).toContainText("needs a human call");
    await expect(banner).not.toContainText("ADR-014");
    await expect(banner.getByRole("link", { name: /Open gate/ })).toHaveAttribute("href", "/gate");
  });

  test("dependency graph drives the 'start here' banner + per-card readiness", async ({ page }) => {
    // A blocks B (B blocked by A); both ready. A is startable; B is not.
    const DEP = [
      { id: "A", project_id: "p1", title: "Backend model", feature: null, priority: 0, status: "ready", origin_quote: null, origin_source: null, description: null, created_at: "2026-01-01", nodes: [], links: [{ id: "l1", from_task: "A", to_task: "B", rel: "blocks", created_at: "" }] },
      { id: "B", project_id: "p1", title: "API endpoints", feature: null, priority: 0, status: "ready", origin_quote: null, origin_source: null, description: null, created_at: "2026-01-01", nodes: [], links: [{ id: "l1", from_task: "A", to_task: "B", rel: "blocks", created_at: "" }] },
    ];
    await page.unrouteAll();
    await mockBacklog(page);
    await page.route("**/api/tasks**", (r) => r.fulfill({ json: { tasks: DEP } }));
    await page.goto("/backlog");

    // "Start here" points at the unblocked task A
    const next = page.getByTestId("next-up-banner");
    await expect(next).toContainText("A");
    await expect(next).toContainText("Backend model");
    await expect(next).toHaveAttribute("href", "/task/A");

    // A is "ready to start"; B shows "blocked by 1"
    const cardA = page.locator('[data-testid="task-card"]', { hasText: "Backend model" });
    const cardB = page.locator('[data-testid="task-card"]', { hasText: "API endpoints" });
    await expect(cardA.getByTestId("tc-startable")).toBeVisible();
    await expect(cardB.getByTestId("tc-blocked")).toContainText("blocked by 1");
  });
});
