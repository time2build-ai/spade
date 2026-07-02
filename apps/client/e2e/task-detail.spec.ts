import { test, expect, type Page } from "@playwright/test";

/**
 * Task detail — REAL data only: real status/priority/feature/origin, real LINKED
 * records (brain nodes grouped into Architectural context / Connected bugs /
 * Tracked metrics / Features, task→task Dependencies), real pipeline runs, plus
 * Task Lifecycle V2 surfaces: the artifacts panel + drawer, the gate action bar,
 * and the Start-lifecycle button.
 */

const BASE = {
  id: "T-1",
  project_id: "p1",
  title: "Optimize mobile checkout speed",
  feature: "Checkout",
  priority: 0,
  status: "building",
  origin_quote: "Checkout is painfully slow on my phone.",
  origin_source: "Intercom · Mar 21",
  description: "Speed up the mobile checkout flow.",
  created_at: "2026-01-01T00:00:00Z",
  nodes: [] as string[],
  links: [] as unknown[],
};

const DEC = { id: "n-dec", project_id: "p1", type: "decision", label: "Use a CDN cache", detail: "**What:** cache at the edge.", x: null, y: null, status: "proposed", owner: null, source: null, updated_at: null };
const BUG = { id: "n-bug", project_id: "p1", type: "bug", label: "Cart jank on iOS", detail: "Janks on scroll.", x: null, y: null, status: null, owner: null, source: null, updated_at: null };

type Extras = {
  nodes?: unknown[];
  pipelines?: unknown[];
  comments?: unknown[];
  runs?: unknown[];
  gates?: unknown[];
  artifacts?: unknown[];
  content?: string;
};

async function mock(page: Page, task: typeof BASE, extra: Extras = {}) {
  const { nodes = [], pipelines = [], comments = [], runs = [], gates = [], artifacts = [], content = "" } = extra;
  await page.route("**/api/projects", (r) =>
    r.fulfill({ json: { projects: [{ id: "p1", name: "Demo", path: "/d", account_strategy: "round_robin", model_ceiling: null, autopilot: 0, created_at: "" }] } }),
  );
  await page.route("**/api/tasks/*/comments", (r) => r.fulfill({ json: { comments } }));
  await page.route("**/api/tasks/*/artifacts/*/content", (r) => r.fulfill({ json: { content } }));
  await page.route("**/api/tasks/*/artifacts", (r) => r.fulfill({ json: { artifacts } }));
  await page.route("**/api/tasks?**", (r) => r.fulfill({ json: { tasks: [task] } }));
  await page.route("**/api/tasks/*", (r) => r.fulfill({ json: task }));
  await page.route("**/api/brain/nodes**", (r) => r.fulfill({ json: { nodes } }));
  await page.route("**/api/pipelines**", (r) => r.fulfill({ json: { pipelines } }));
  await page.route("**/api/lifecycle**", (r) => r.fulfill({ json: { runs } }));
  await page.route("**/api/projects/*/gates", (r) => r.fulfill({ json: { gates } }));
}

test.describe("task detail", () => {
  test("page head: real status chip + graph nav + Start-lifecycle + breadcrumb", async ({ page }) => {
    await mock(page, BASE);
    await page.goto("/task/T-1");
    await expect(page.locator(".td-title")).toHaveText("Optimize mobile checkout speed");
    await expect(page.getByTestId("task-status-chip")).toContainText("building");
    await expect(page.getByRole("link", { name: /View in graph/ })).toHaveAttribute("href", "/brain");
    // no lifecycle run yet → "Start lifecycle"
    await expect(page.getByTestId("start-lifecycle")).toContainText("Start lifecycle");
    await expect(page.locator(".breadcrumb").getByRole("link", { name: "Backlog" })).toHaveAttribute("href", "/backlog");
  });

  test("shows the real origin quote + source", async ({ page }) => {
    await mock(page, BASE);
    await page.goto("/task/T-1");
    const main = page.locator(".td-main");
    await expect(main).toContainText("Origin");
    await expect(main).toContainText("Checkout is painfully slow on my phone.");
    await expect(main).toContainText("Intercom · Mar 21");
  });

  test("linked brain nodes render grouped link-rows to their record pages", async ({ page }) => {
    await mock(page, { ...BASE, nodes: ["n-dec", "n-bug"] }, { nodes: [DEC, BUG] });
    await page.goto("/task/T-1");
    const main = page.locator(".td-main");
    await expect(main).toContainText("Architectural context");
    await expect(main).toContainText("Use a CDN cache");
    await expect(main).toContainText("Connected bugs");
    await expect(main).toContainText("Cart jank on iOS");
    await expect(page.getByTestId("td-link-row").filter({ hasText: "Use a CDN cache" })).toHaveAttribute("href", "/decisions#dec-n-dec");
    await expect(page.getByTestId("td-link-row").filter({ hasText: "Cart jank on iOS" })).toHaveAttribute("href", "/brain?node=n-bug");
  });

  test("honest empty state when nothing is linked", async ({ page }) => {
    await mock(page, BASE);
    await page.goto("/task/T-1");
    await expect(page.locator(".td-main")).toContainText("Linked records");
    await expect(page.locator(".td-main")).toContainText("No decisions, bugs, metrics or dependencies");
  });

  test("Start lifecycle calls /lifecycle/start and stays on the task", async ({ page }) => {
    let started = false;
    await mock(page, BASE);
    await page.route("**/api/lifecycle/start", (r) => {
      started = true;
      return r.fulfill({ json: { id: "run-x", project_id: "p1", task_id: "T-1", phase: "shaping", active: 1 } });
    });
    await page.goto("/task/T-1");
    await page.getByTestId("start-lifecycle").click();
    await expect.poll(() => started).toBe(true);
    await expect(page).toHaveURL(/\/task\/T-1$/);
  });

  test("artifacts panel opens a drawer that renders the artifact markdown", async ({ page }) => {
    const ARTS = [
      { id: "a1", task_id: "T-1", run_id: "r1", kind: "spec", title: "Spec doc", repo_path: "docs/spec.md", branch: "feat/x", created_by: "shaping", created_at: "2026-01-02" },
    ];
    await mock(page, BASE, { artifacts: ARTS, content: "# The spec\nDo the thing." });
    await page.goto("/task/T-1");
    const panel = page.getByTestId("artifacts-panel");
    await expect(panel).toBeVisible();
    await panel.getByTestId("artifact-row").first().click();
    const drawer = page.getByTestId("artifact-drawer");
    await expect(drawer).toBeVisible();
    await expect(drawer).toContainText("The spec");
    await expect(drawer).toContainText("Do the thing.");
    await drawer.getByTestId("artifact-close").click();
    await expect(page.getByTestId("artifact-drawer")).toHaveCount(0);
  });

  test("test guide drawer renders numbered steps + checkboxes + a print button", async ({ page }) => {
    const ARTS = [
      { id: "tg", task_id: "T-1", run_id: "r1", kind: "test_guide", title: "How to test", repo_path: "docs/test.md", branch: "feat/x", created_by: "building", created_at: "2026-01-02" },
    ];
    await mock(page, BASE, { artifacts: ARTS, content: "1. Open the app\n2. Tap checkout\n3. See the fast page" });
    await page.goto("/task/T-1");
    await page.getByTestId("artifacts-panel").getByTestId("artifact-row").first().click();
    const drawer = page.getByTestId("artifact-drawer");
    await expect(drawer.getByTestId("test-guide-steps")).toBeVisible();
    await expect(drawer.getByTestId("test-guide-checkbox")).toHaveCount(3);
    await expect(drawer.getByTestId("artifact-print")).toBeVisible();
  });

  test("gate action bar: Approve calls the approve endpoint", async ({ page }) => {
    let approved = false;
    const GATES = [
      { id: "g1", task_id: "T-1", run_id: "r1", gate: "manual_test", status: "waiting", comment: null, decided_by: null, decided_at: null, created_at: "", task_title: "Optimize mobile checkout speed", phase: "building" },
    ];
    await mock(page, BASE, { gates: GATES });
    await page.route("**/api/tasks/*/gates/*/approve", (r) => {
      approved = true;
      return r.fulfill({ json: { id: "r1", project_id: "p1", task_id: "T-1", phase: "shipped", active: 1 } });
    });
    await page.goto("/task/T-1");
    const bar = page.getByTestId("gate-bar");
    await expect(bar).toBeVisible();
    await expect(bar).toContainText("Manual test");
    await bar.getByTestId("gate-approve").click();
    await expect.poll(() => approved).toBe(true);
  });

  test("timeline renders lifecycle comment kinds with icons", async ({ page }) => {
    const RUN = { id: "r1", task_id: "T-1", project_id: "p1", status: "shipped", progress: 100, stages: [{ id: "s", pipeline_run_id: "r1", role: "developer", stage_order: 0, state: "done", session_id: null, account_id: null, created_at: "" }] };
    const COMMENTS = [
      { id: "c1", author: "shaping", kind: "progress", body: "Shaping complete.", created_at: "2026-06-28T10:00:00Z" },
      { id: "c2", author: "system", kind: "gate", body: "Plan ready for review — plan gate opened.", created_at: "2026-06-28T10:30:00Z" },
      { id: "c3", author: "pr_review", kind: "review", body: "Review done.", created_at: "2026-06-28T11:00:00Z" },
    ];
    await mock(page, BASE, { pipelines: [RUN], comments: COMMENTS });
    await page.goto("/task/T-1");
    const notes = page.getByTestId("pipeline-note");
    await expect(notes).toHaveCount(3);
    await expect(page.getByTestId("note-kind-icon")).toHaveCount(3);
    await expect(notes.filter({ hasText: "plan gate opened" })).toHaveAttribute("data-kind", "gate");
  });

  test("properties rail shows real fields only", async ({ page }) => {
    await mock(page, BASE);
    await page.goto("/task/T-1");
    const rail = page.locator(".td-side");
    for (const k of ["Status", "Priority", "Feature", "Created", "Task id", "Linked records"]) {
      await expect(rail).toContainText(k);
    }
    for (const k of ["Assignee", "Estimate", "Branch", "Will write back"]) {
      await expect(rail).not.toContainText(k);
    }
  });
});
