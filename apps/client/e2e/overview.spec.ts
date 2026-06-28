import { test, expect, type Page } from "@playwright/test";

/**
 * Overview is REAL — task progress, live KPIs and brain-derived summaries, with
 * honest empty states. No fabricated demo data (no "34% mobile checkout", no
 * 847 brain nodes) on a fresh project.
 */
const PROJECT = { id: "p1", name: "Todo App", path: "/d", account_strategy: "round_robin", model_ceiling: null, autopilot: 0, created_at: "" };

async function mock(page: Page, data: {
  tasks?: object[]; nodes?: object[]; edges?: object[]; pipelines?: object[]; sprints?: object[]; feedback?: object[];
}) {
  await page.route("**/api/projects", (r) => r.fulfill({ json: { projects: [PROJECT] } }));
  await page.route("**/api/brakes", (r) => r.fulfill({ json: { brakes: [] } }));
  await page.route("**/api/accounts", (r) => r.fulfill({ json: { accounts: [] } }));
  await page.route("**/api/sessions", (r) => r.fulfill({ json: { sessions: [] } }));
  await page.route("**/api/tasks**", (r) => r.fulfill({ json: { tasks: data.tasks ?? [] } }));
  await page.route("**/api/brain/nodes**", (r) => r.fulfill({ json: { nodes: data.nodes ?? [] } }));
  await page.route("**/api/brain/edges**", (r) => r.fulfill({ json: { edges: data.edges ?? [] } }));
  await page.route("**/api/pipelines**", (r) => r.fulfill({ json: { pipelines: data.pipelines ?? [] } }));
  await page.route("**/api/sprints**", (r) => r.fulfill({ json: { sprints: data.sprints ?? [] } }));
  await page.route("**/api/feedback**", (r) => r.fulfill({ json: { clusters: data.feedback ?? [] } }));
}

const task = (id: string, status: string) => ({ id, project_id: "p1", title: `Task ${id}`, status, feature: null, priority: 2, created_at: "", nodes: [], links: [] });
const node = (id: string, type: string, label: string) => ({ id, project_id: "p1", type, label, detail: null, x: null, y: null, created_at: "" });

test.describe("overview (real)", () => {
  test("empty project → honest empty states, no demo numbers", async ({ page }) => {
    await mock(page, {});
    await page.goto("/overview");
    await expect(page.getByTestId("ov-hero")).toContainText("Nothing planned yet");
    const vals = await page.getByTestId("ov-kpis").locator(".val").allTextContents();
    expect(vals).toEqual(["0", "0", "0", "0"]);
    await expect(page.getByTestId("ov-now")).toContainText("Nothing running");
    await expect(page.getByTestId("ov-grid")).toContainText("No decisions yet");
    await expect(page.getByTestId("ov-grid")).toContainText("No bugs logged");
  });

  test("populated project → real progress + KPIs + brain summaries", async ({ page }) => {
    await mock(page, {
      tasks: [task("T1", "shipped"), task("T2", "in_progress"), task("T3", "ready"), task("T4", "ready")],
      nodes: [node("n1", "feature", "Add a todo"), node("n2", "decision", "Use FastAPI"), node("n3", "bug", "Toggle flicker"), node("n4", "metric", "Todos / day")],
      edges: [{ id: "e1", project_id: "p1", from_id: "n1", to_id: "n2", rel: null }],
      pipelines: [{ id: "r1", project_id: "p1", task_id: "T2", status: "running", current_stage: 0, created_at: "", stages: [{ id: "s0", pipeline_run_id: "r1", role: "developer", stage_order: 0, state: "running", session_id: null, account_id: null, created_at: "" }] }],
      sprints: [{ id: "s1", project_id: "p1", number: 7, day_label: "day 2/10", state: "active", started_at: null, created_at: "", shipped: 1, review: 0, progress: 1, queued: 2, total: 4 }],
      feedback: [{ id: "fc1", project_id: "p1", label: "Slow on mobile", count: 5, sources: [], created_at: "" }],
    });
    await page.goto("/overview");
    await expect(page.locator(".ov-hero-val")).toHaveText("25%");
    await expect(page.getByTestId("ov-statusbar").locator("span")).not.toHaveCount(0);
    const vals = await page.getByTestId("ov-kpis").locator(".val").allTextContents();
    expect(vals).toEqual(["4", "1", "0", "4"]);
    await expect(page.getByTestId("ov-now")).toContainText("Task T2");
    await expect(page.getByTestId("ov-grid")).toContainText("Use FastAPI");
    await expect(page.getByTestId("ov-grid")).toContainText("Toggle flicker");
    await expect(page.getByTestId("ov-grid")).toContainText("Slow on mobile · 5");
  });
});
