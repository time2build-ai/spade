import { test, expect, type Page } from "@playwright/test";

/**
 * Task detail — REAL data only: real status/priority/feature/origin, real LINKED
 * records (brain nodes grouped into Architectural context / Connected bugs /
 * Tracked metrics / Features, task→task Dependencies) and real pipeline runs.
 * No fabricated feedback strip / quote cards / sparkline / assignee / sprint /
 * estimate / branch / "will write back".
 */

const BASE = {
  id: "T-1",
  project_id: "p1",
  title: "Optimize mobile checkout speed",
  feature: "Checkout",
  priority: 0,
  status: "in_progress",
  origin_quote: "Checkout is painfully slow on my phone.",
  origin_source: "Intercom · Mar 21",
  description: "Speed up the mobile checkout flow.",
  created_at: "2026-01-01T00:00:00Z",
  nodes: [] as string[],
  links: [] as unknown[],
};

const DEC = { id: "n-dec", project_id: "p1", type: "decision", label: "Use a CDN cache", detail: "**What:** cache at the edge.", x: null, y: null, status: "proposed", owner: null, source: null, updated_at: null };
const BUG = { id: "n-bug", project_id: "p1", type: "bug", label: "Cart jank on iOS", detail: "Janks on scroll.", x: null, y: null, status: null, owner: null, source: null, updated_at: null };

async function mock(page: Page, task: typeof BASE, nodes: unknown[] = [], pipelines: unknown[] = []) {
  await page.route("**/api/tasks?**", (r) => r.fulfill({ json: { tasks: [task] } }));
  await page.route("**/api/tasks/*", (r) => r.fulfill({ json: task }));
  await page.route("**/api/brain/nodes**", (r) => r.fulfill({ json: { nodes } }));
  await page.route("**/api/pipelines**", (r) => r.fulfill({ json: { pipelines } }));
}

test.describe("task detail", () => {
  test("page head: real status chip + graph/orchestrator nav + breadcrumb", async ({ page }) => {
    await mock(page, BASE);
    await page.goto("/task/T-1");
    await expect(page.locator(".td-title")).toHaveText("Optimize mobile checkout speed");
    await expect(page.getByTestId("task-status-chip")).toContainText("in_progress");
    await expect(page.getByRole("link", { name: /View in graph/ })).toHaveAttribute("href", "/brain");
    // never run → "Start pipeline" (not "Resume")
    await expect(page.getByTestId("run-pipeline")).toContainText("Start pipeline");
    await expect(page.getByTestId("run-pipeline")).toHaveAttribute("href", "/orchestrator");
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
    await mock(page, { ...BASE, nodes: ["n-dec", "n-bug"] }, [DEC, BUG]);
    await page.goto("/task/T-1");
    const main = page.locator(".td-main");
    await expect(main).toContainText("Architectural context");
    await expect(main).toContainText("Use a CDN cache");
    await expect(main).toContainText("Connected bugs");
    await expect(main).toContainText("Cart jank on iOS");
    // decision row links to the decisions record; bug row to the brain node
    await expect(page.getByTestId("td-link-row").filter({ hasText: "Use a CDN cache" })).toHaveAttribute("href", "/decisions#dec-n-dec");
    await expect(page.getByTestId("td-link-row").filter({ hasText: "Cart jank on iOS" })).toHaveAttribute("href", "/brain?node=n-bug");
  });

  test("honest empty state when nothing is linked", async ({ page }) => {
    await mock(page, BASE);
    await page.goto("/task/T-1");
    await expect(page.locator(".td-main")).toContainText("Linked records");
    await expect(page.locator(".td-main")).toContainText("No decisions, bugs, metrics or dependencies");
  });

  test("pipeline history: real run when present, honest note when not", async ({ page }) => {
    // empty
    await mock(page, BASE);
    await page.goto("/task/T-1");
    await expect(page.locator(".td-main")).toContainText("Pipeline history");
    await expect(page.locator(".td-main")).toContainText("Not run yet");

    // a live run for this task
    await page.unrouteAll();
    await mock(page, BASE, [], [{ id: "run1", task_id: "T-1", project_id: "p1", status: "running", progress: 40, stages: [{ id: "s", pipeline_run_id: "run1", role: "Developer", stage_order: 0, state: "running", session_id: null, account_id: null, created_at: "" }] }]);
    await page.goto("/task/T-1");
    await expect(page.locator(".timeline .tl-item")).toHaveCount(1);
    await expect(page.locator(".timeline .tl-item.now")).toHaveCount(1);
    // a run exists → the action says "Resume pipeline"
    await expect(page.getByTestId("run-pipeline")).toContainText("Resume pipeline");
  });

  test("properties rail shows real fields only", async ({ page }) => {
    await mock(page, BASE);
    await page.goto("/task/T-1");
    const rail = page.locator(".td-side");
    for (const k of ["Status", "Priority", "Feature", "Created", "Task id", "Linked records"]) {
      await expect(rail).toContainText(k);
    }
    // no fabricated rail fields
    for (const k of ["Assignee", "Estimate", "Branch", "Will write back"]) {
      await expect(rail).not.toContainText(k);
    }
  });
});
