import { test, expect, type Page } from "@playwright/test";

/**
 * Home dashboard is REAL — full-bleed (sidebar hidden), with a triage feed built
 * from real signals (gates, running pipelines, blocked tasks), real KPIs and a
 * projects table derived from per-project task/brain/pipeline data. Honest empty
 * states; no seeded Acme/Beta triage.
 */
const project = (id: string, name: string) => ({ id, name, path: `${id}/web`, account_strategy: "round_robin", model_ceiling: null, autopilot: 0, created_at: "" });
const task = (id: string, status: string) => ({ id, project_id: "p1", title: `Task ${id}`, status, feature: null, priority: 2, origin_quote: null, origin_source: null, description: null, created_at: "", nodes: [], links: [] });
const node = (id: string) => ({ id, project_id: "p1", type: "feature", label: id, detail: null, x: null, y: null, created_at: "" });

async function mockEmpty(page: Page) {
  await page.route("**/api/projects", (r) => r.fulfill({ json: { projects: [project("p1", "Todo App")] } }));
  await page.route("**/api/brakes", (r) => r.fulfill({ json: { brakes: [] } }));
  await page.route("**/api/sessions", (r) => r.fulfill({ json: { sessions: [] } }));
  await page.route("**/api/tasks**", (r) => r.fulfill({ json: { tasks: [] } }));
  await page.route("**/api/brain/nodes**", (r) => r.fulfill({ json: { nodes: [] } }));
  await page.route("**/api/pipelines**", (r) => r.fulfill({ json: { pipelines: [] } }));
}

async function mockPopulated(page: Page) {
  await page.route("**/api/projects", (r) => r.fulfill({ json: { projects: [project("p1", "Todo App")] } }));
  await page.route("**/api/brakes", (r) => r.fulfill({ json: { brakes: [{ id: "b1", mission: "SPD-9 paused", brake: "needs a human call", detail: "", worker: "sess_x" }] } }));
  await page.route("**/api/sessions", (r) => r.fulfill({ json: { sessions: [{ id: "s1", alive: true }] } }));
  await page.route("**/api/tasks**", (r) => r.fulfill({ json: { tasks: [task("T1", "ready"), task("T2", "blocked"), task("T3", "shipped")] } }));
  await page.route("**/api/brain/nodes**", (r) => r.fulfill({ json: { nodes: [node("n1"), node("n2")] } }));
  await page.route("**/api/pipelines**", (r) =>
    r.fulfill({ json: { pipelines: [{ id: "r1", project_id: "p1", task_id: "T1", status: "running", current_stage: 0, created_at: "", stages: [] }] } }),
  );
}

test.describe("home dashboard (real)", () => {
  test("is full-bleed (sidebar hidden)", async ({ page }) => {
    await mockEmpty(page);
    await page.goto("/");
    await expect(page.getByTestId("home-root")).toBeVisible();
    await expect(page.locator("body")).toHaveClass(/home-mode/);
    await expect(page.locator("aside.sidebar")).toBeHidden();
  });

  test("empty signals → honest empty states", async ({ page }) => {
    await mockEmpty(page);
    await page.goto("/");
    await expect(page.getByTestId("triage-feed")).toContainText("Nothing in the triage feed yet.");
    await expect(page.getByTestId("triage-feed").getByTestId("tri-item")).toHaveCount(0);
    // KPI band still renders 5 cells, all derived from real (zero) data.
    await expect(page.getByTestId("home-kpis").locator(".home-kpi")).toHaveCount(5);
    await expect(page.getByTestId("projects-table").getByTestId("proj-row")).toHaveCount(1);
    // No seeded Acme/Beta content.
    await expect(page.getByTestId("home-root")).not.toContainText("Acme");
  });

  test("real signals drive the triage feed + projects table", async ({ page }) => {
    await mockPopulated(page);
    await page.goto("/");
    const feed = page.getByTestId("triage-feed");
    // Gate + running pipeline + blocked task.
    await expect(feed).toContainText("SPD-9 paused");
    await expect(feed).toContainText("Task T1"); // running pipeline → task title
    await expect(feed).toContainText("Task T2"); // blocked task
    await expect(feed.getByTestId("tri-item").first()).toBeVisible();
    // Projects table shows real per-project counts (2 brain nodes).
    const row = page.getByTestId("projects-table").getByTestId("proj-row").first();
    await expect(row).toContainText("Todo App");
    await expect(row).toContainText("2"); // brain nodes
  });
});
