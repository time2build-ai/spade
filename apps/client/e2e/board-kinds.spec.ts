import { test, expect, type Page } from "@playwright/test";

/**
 * Universal board with mixed kinds (Task-Type Router). Code / research / docs
 * tasks all share the 5 universal columns (Ready · Planning · In progress ·
 * Review · Done), bucketed via the /lifecycle/templates mapping. Asserts the
 * kind badges, the `▶ N agents` fan-out card, the kind filter, and the router
 * suggestion chip on an untyped task. Mocks the API.
 */

const TEMPLATES = {
  templates: {
    code: {
      terminal_status: "shipped",
      columns: {
        shaping: "Planning", plan_review: "Planning", building: "In progress",
        pr_review: "Review", shipped: "Done",
      },
      phases: [],
    },
    research: {
      terminal_status: "delivered",
      columns: {
        scoping: "Planning", investigating: "In progress", synthesis: "Review",
        delivered: "Done",
      },
      phases: [],
    },
    docs: {
      terminal_status: "delivered",
      columns: { outline: "Planning", drafting: "Review", delivered: "Done" },
      phases: [],
    },
  },
  gate_labels: {},
  artifact_labels: {},
};

function task(over: Record<string, unknown>) {
  return {
    id: "X", project_id: "p1", title: "T", feature: null, priority: 1,
    status: "ready", kind: null, kind_suggested: null, kind_reason: null,
    doc_template: null, origin_quote: null, origin_source: null,
    description: null, created_at: "2026-01-01T00:00:00Z", nodes: [], links: [],
    ...over,
  };
}

const TASKS = [
  task({ id: "C-1", title: "Code card", status: "building", kind: "code" }),
  task({ id: "R-1", title: "Research card", status: "investigating", kind: "research" }),
  task({ id: "D-1", title: "Docs card", status: "drafting", kind: "docs" }),
  task({ id: "G-1", title: "Gated card", status: "building", kind: "code" }),
  task({ id: "U-1", title: "Untyped card", status: "ready", kind: null, kind_suggested: "research", kind_reason: "matched 'investigate'" }),
];

function run(over: Record<string, unknown>) {
  return {
    id: "r", project_id: "p1", task_id: "X", kind: "code", phase: "building",
    active: 1, fanout_count: 0, branch_name: null, worktree_path: null,
    pr_number: null, pr_url: null, merge_commit: null, env_dev_at: null,
    env_staging_at: null, env_prod_at: null, agent_session_id: null,
    account_id: null, blocked_reason: null, blocked_from_phase: null,
    self_heal_attempts: 0, last_finished_session: null,
    created_at: "2026-01-02", updated_at: "2026-01-02",
    ...over,
  };
}

const RUNS = [
  run({ id: "rc", task_id: "C-1", kind: "code", phase: "building" }),
  run({ id: "rr", task_id: "R-1", kind: "research", phase: "investigating", fanout_count: 3 }),
  run({ id: "rd", task_id: "D-1", kind: "docs", phase: "drafting" }),
  run({ id: "rg", task_id: "G-1", kind: "code", phase: "building" }),
];

// G-1 sits at a waiting manual_test gate → amber "waiting on you" card.
const GATES = [
  { id: "g1", task_id: "G-1", run_id: "rg", gate: "manual_test", status: "waiting", comment: null, decided_by: null, decided_at: null, created_at: "", task_title: "Gated card", phase: "building" },
];

async function mockBoard(page: Page) {
  await page.route("**/api/projects", (r) =>
    r.fulfill({ json: { projects: [{ id: "p1", name: "Demo", path: "/demo", account_strategy: "round_robin", model_ceiling: null, autopilot: 0, created_at: "" }] } }),
  );
  await page.route("**/api/tasks**", (r) => r.fulfill({ json: { tasks: TASKS } }));
  await page.route("**/api/brain/nodes**", (r) => r.fulfill({ json: { nodes: [] } }));
  await page.route("**/api/projects/*/gates", (r) => r.fulfill({ json: { gates: GATES } }));
  await page.route("**/api/lifecycle**", (r) => r.fulfill({ json: { runs: RUNS } }));
  await page.route("**/api/lifecycle/templates", (r) => r.fulfill({ json: TEMPLATES }));
}

test.describe("board-kinds", () => {
  test.beforeEach(async ({ page }) => {
    await mockBoard(page);
    await page.goto("/backlog");
    await expect(page.locator(".backlog-grid")).toBeVisible();
  });

  test("renders the 5 universal columns", async ({ page }) => {
    await expect(page.locator(".backlog-grid .col")).toHaveCount(5);
    for (const label of ["Ready", "Planning", "In progress", "Review", "Done"]) {
      await expect(page.locator(".col-head", { hasText: label })).toHaveCount(1);
    }
  });

  test("mixed kinds bucket into columns with their kind badge", async ({ page }) => {
    // research investigating → In progress; docs drafting → Review; code building → In progress
    const inProgress = page.locator('[data-status="In progress"]');
    await expect(inProgress.locator('[data-testid="task-card"]', { hasText: "Research card" })).toBeVisible();
    await expect(inProgress.locator('[data-testid="task-card"]', { hasText: "Code card" })).toBeVisible();
    const review = page.locator('[data-status="Review"]');
    await expect(review.locator('[data-testid="task-card"]', { hasText: "Docs card" })).toBeVisible();

    const research = page.locator('[data-testid="task-card"]', { hasText: "Research card" });
    await expect(research.getByTestId("kind-badge")).toHaveText(/Research/);
    const docs = page.locator('[data-testid="task-card"]', { hasText: "Docs card" });
    await expect(docs.getByTestId("kind-badge")).toHaveText(/Docs/);
  });

  test("a fan-out research card shows the ▶ N agents count", async ({ page }) => {
    const research = page.locator('[data-testid="task-card"]', { hasText: "Research card" });
    await expect(research.getByTestId("fanout-count")).toContainText("3 agents");
  });

  test("the kind filter narrows the board to a single kind", async ({ page }) => {
    await page.getByTestId("filter-menu-btn").click(); // filters live in a dropdown now
    await page.getByTestId("kind-filter-research").click();
    await expect(page.locator('[data-testid="task-card"]', { hasText: "Research card" })).toBeVisible();
    await expect(page.locator('[data-testid="task-card"]', { hasText: "Code card" })).toHaveCount(0);
    await expect(page.locator('[data-testid="task-card"]', { hasText: "Docs card" })).toHaveCount(0);
  });

  test("an untyped task shows the router suggestion chip", async ({ page }) => {
    const untyped = page.locator('[data-testid="task-card"]', { hasText: "Untyped card" });
    await expect(untyped.getByTestId("router-suggestion")).toContainText("Research");
    await expect(untyped.getByTestId("kind-confirm")).toBeVisible();
  });

  test("the gated card surfaces the 'Waiting on you' status", async ({ page }) => {
    const gated = page.locator('[data-testid="task-card"]', { hasText: "Gated card" });
    await expect(gated).toContainText("Waiting on you");
  });
});
