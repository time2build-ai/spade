import { test, expect, type Page } from "@playwright/test";

/**
 * Graph & Issues is REAL — the node graph plus an AI-issues pane driven by real
 * gap-analysis findings. No gaps → honest empty state (no seeded AI-ISS list).
 */
const NODES = ["feature", "decision", "bug", "feedback"].map((type, i) => ({
  id: `n${i}`, project_id: "p1", type, label: `${type} node`, detail: null, x: 0.2 + i * 0.2, y: 0.3, created_at: null,
}));

async function mock(page: Page) {
  await page.route("**/api/projects", (r) =>
    r.fulfill({ json: { projects: [{ id: "p1", name: "Demo", path: "/d", account_strategy: "round_robin", model_ceiling: null, autopilot: 0, created_at: "" }] } }),
  );
  await page.route("**/api/brain/nodes**", (r) => r.fulfill({ json: { nodes: NODES } }));
  await page.route("**/api/brain/edges**", (r) => r.fulfill({ json: { edges: [] } }));
  await page.route("**/api/brain/gaps**", (r) => r.fulfill({ json: { gaps: [] } }));
}

test.describe("graph & issues (real)", () => {
  test.beforeEach(async ({ page }) => {
    await mock(page);
    await page.goto("/graph-issues");
    await expect(page.locator(".gi-wrap")).toBeVisible();
  });

  test("renders the graph pane (legend + canvas) and the issues pane", async ({ page }) => {
    await expect(page.locator(".gi-graph-pane .legend-dot").first()).toBeVisible();
    await expect(page.locator(".gi-graph-pane svg").first()).toBeVisible();
    await expect(page.getByTestId("gi-issues")).toBeVisible();
  });

  test("no gaps → honest empty state (no seeded AI issues)", async ({ page }) => {
    const pane = page.getByTestId("gi-issues");
    await expect(pane).toContainText("No graph issues yet.");
    await expect(pane.locator(".gi-issue")).toHaveCount(0);
    await expect(pane).not.toContainText("AI-ISS-241");
  });

  test("page head shows counts + actions", async ({ page }) => {
    await expect(page.locator(".page-head")).toContainText("Graph & Issues");
    await expect(page.getByRole("button", { name: /Re-analyze subgraph/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /New manual issue/ })).toBeVisible();
  });
});

test.describe("graph & issues (real gaps)", () => {
  test("real gap-analysis findings drive the AI-issues pane", async ({ page }) => {
    await mock(page);
    await page.route("**/api/brain/gaps**", (r) =>
      r.fulfill({ json: { gaps: [
        { id: "n0", kind: "orphan", label: "Lonely feature", detail: "This feature has no connections." },
        { id: "n1", kind: "unresolved-decision", label: "Adopt X", detail: "A proposed decision not yet accepted." },
      ] } }),
    );
    await page.goto("/graph-issues");
    const pane = page.getByTestId("gi-issues");
    await expect(pane.locator(".gi-issue")).toHaveCount(2);
    await expect(pane).toContainText("Lonely feature");
    await expect(pane).toContainText("gap-analysis (orphan)");
  });
});
