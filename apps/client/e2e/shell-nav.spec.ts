import { test, expect, type Page } from "@playwright/test";
import { sidebar } from "./_helpers";

/**
 * V2 PR-2 — full-parity sidebar (project + workspace groups, REAL count badges,
 * Brain↔Graph split into separate routes, Ask ⌘K badge, no "Próximamente").
 */

// [label, expected data-icon] for the project-scoped nav.
const ICONS: [string, string][] = [
  ["Overview", "graph"],
  ["Ask", "spark"],
  ["Sprints", "board"],
  ["Backlog", "tasks"],
  ["Product brain", "brain"],
  ["Graph & Issues", "graph"],
  ["Orchestrator", "orch"],
  ["Agent pool", "spark"],
  ["Human gates", "gate"],
  ["Meetings", "mic"],
  ["Feedback", "flag"],
  ["Decisions", "doc"],
  ["CLI / logs", "term"],
  ["Settings", "cog"],
];

test.describe("sidebar nav (full parity)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/backlog");
    await expect(sidebar(page)).toBeVisible();
  });

  test("project group sections appear in reference order", async ({ page }) => {
    const labels = await sidebar(page).locator(".proj-only .sb-label").allTextContents();
    expect(labels).toEqual(["Project", "Plan", "Execution", "Inputs", "System"]);
  });

  for (const [label, icon] of ICONS) {
    test(`"${label}" uses the ${icon} icon`, async ({ page }) => {
      const item = sidebar(page).locator(".proj-only .sb-item", { hasText: label });
      await expect(item.first().locator("svg[data-icon]")).toHaveAttribute("data-icon", icon);
    });
  }

  test("Product brain and Graph & Issues are separate routes", async ({ page }) => {
    await expect(
      sidebar(page).locator('.proj-only .sb-item[href="/brain"]', { hasText: "Product brain" }),
    ).toHaveCount(1);
    await expect(
      sidebar(page).locator('.proj-only .sb-item[href="/graph-issues"]', { hasText: "Graph & Issues" }),
    ).toHaveCount(1);
  });

  test("Ask has a ⌘K badge", async ({ page }) => {
    const ask = sidebar(page).locator(".proj-only .sb-item", { hasText: "Ask" });
    await expect(ask.locator(".badge")).toHaveText("⌘K");
  });

  test("no 'Próximamente' / soon items remain", async ({ page }) => {
    await expect(page.locator(".sb-item.soon")).toHaveCount(0);
    await expect(page.getByText("Próximamente")).toHaveCount(0);
  });

  test("workspace level swaps to the ws-only groups", async ({ page }) => {
    await page.goto("/workspace/settings");
    await expect(page.locator("body")).toHaveClass(/workspace-level/);
    const wsLabels = await sidebar(page).locator(".ws-only .sb-label").allTextContents();
    expect(wsLabels).toEqual(["Workspace", "Projects"]);
    // Project groups are hidden at workspace level.
    await expect(sidebar(page).locator(".proj-only")).toBeHidden();
  });
});

// Badges show REAL counts (no fabricated demo numbers) and disappear when 0.
async function mockCounts(page: Page, opts: { empty?: boolean } = {}) {
  const N = opts.empty ? 0 : 1;
  const arr = (n: number, mk: (i: number) => object) => Array.from({ length: n }, (_, i) => mk(i));
  await page.route("**/api/projects", (r) =>
    r.fulfill({ json: { projects: [{ id: "p1", name: "Demo", path: "/d", account_strategy: "round_robin", model_ceiling: null, autopilot: 0, created_at: "" }] } }));
  await page.route("**/api/sessions", (r) => r.fulfill({ json: { sessions: [] } }));
  await page.route("**/api/accounts", (r) => r.fulfill({ json: { accounts: arr(opts.empty ? 0 : 2, (i) => ({ id: `a${i}`, label: `a${i}`, provider: "claude", config_dir: "", is_default: i === 0 ? 1 : 0, color: null, created_at: "" })) } }));
  await page.route("**/api/brakes", (r) => r.fulfill({ json: { brakes: [] } }));
  await page.route("**/api/tasks**", (r) => r.fulfill({ json: { tasks: arr(opts.empty ? 0 : 3, (i) => ({ id: `T${i}`, project_id: "p1", title: `t${i}`, status: "ready", feature: null, priority: 2, created_at: "", nodes: [], links: [] })) } }));
  await page.route("**/api/brain/nodes**", (r) => r.fulfill({ json: { nodes: arr(opts.empty ? 0 : 5, (i) => ({ id: `n${i}`, project_id: "p1", type: i === 0 ? "decision" : "feature", label: `n${i}`, detail: null, x: null, y: null, created_at: "" })) } }));
  await page.route("**/api/brain/edges**", (r) => r.fulfill({ json: { edges: arr(opts.empty ? 0 : 4, (i) => ({ id: `e${i}`, project_id: "p1", from_id: "n1", to_id: "n0", rel: null })) } }));
  await page.route("**/api/pipelines**", (r) => r.fulfill({ json: { pipelines: [] } }));
  await page.route("**/api/sprints**", (r) => r.fulfill({ json: { sprints: arr(N, (i) => ({ id: `s${i}`, project_id: "p1", number: 1, day_label: "day 1/10", state: "active", started_at: null, created_at: "", shipped: 0, review: 0, progress: 0, queued: 0, total: 0 })) } }));
  await page.route("**/api/meetings**", (r) => r.fulfill({ json: { meetings: arr(N, (i) => ({ id: `m${i}`, project_id: "p1", title: "m", date: null, summary: null, attendees: [], created_at: "" })) } }));
  await page.route("**/api/feedback**", (r) => r.fulfill({ json: { clusters: arr(opts.empty ? 0 : 2, (i) => ({ id: `fc${i}`, project_id: "p1", label: "f", count: 1, sources: [], created_at: "" })) } }));
}

test.describe("sidebar count badges are real", () => {
  test("an empty project shows NO count badges (no fabricated demo numbers)", async ({ page }) => {
    await mockCounts(page, { empty: true });
    await page.goto("/backlog");
    await expect(sidebar(page)).toBeVisible();
    const item = (label: string) => sidebar(page).locator(".proj-only .sb-item", { hasText: label });
    for (const label of ["Sprints", "Backlog", "Product brain", "Meetings", "Feedback", "Decisions"]) {
      await expect(item(label).locator(".badge")).toHaveCount(0);
    }
  });

  test("badges reflect the live counts", async ({ page }) => {
    await mockCounts(page);
    await page.goto("/backlog");
    await expect(sidebar(page)).toBeVisible();
    const item = (label: string) => sidebar(page).locator(".proj-only .sb-item", { hasText: label });
    await expect(item("Backlog").locator(".badge")).toHaveText("3");
    await expect(item("Sprints").locator(".badge")).toHaveText("1");
    await expect(item("Meetings").locator(".badge")).toHaveText("1");
    await expect(item("Feedback").locator(".badge")).toHaveText("2");
    await expect(item("Graph & Issues").locator(".badge")).toHaveText("4");
    await expect(item("Decisions").locator(".badge")).toHaveText("1");
  });
});
