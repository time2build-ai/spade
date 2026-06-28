import { test, expect, type Page } from "@playwright/test";

/**
 * V2 Phase 1 — Graph & Issues route: the node graph (moved out of /brain) plus
 * a seeded AI-issues pane. Mocks the brain API.
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
  // Default: no real gaps → the AI-issues pane falls back to the seed.
  await page.route("**/api/brain/gaps**", (r) => r.fulfill({ json: { gaps: [] } }));
}

test.describe("graph & issues", () => {
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

  test("issues pane lists seeded AI issues with status", async ({ page }) => {
    const pane = page.getByTestId("gi-issues");
    await expect(pane.locator(".gi-issue").first()).toBeVisible();
    await expect(pane).toContainText("AI-ISS-241");
    await expect(pane.locator('.gi-issue[data-status="validated"]').first()).toBeVisible();
    await expect(pane.locator('.gi-issue[data-status="rejected"]').first()).toBeVisible();
  });

  test("page head shows counts + actions", async ({ page }) => {
    await expect(page.locator(".page-head")).toContainText("Graph & Issues");
    await expect(page.getByRole("button", { name: /Re-analyze subgraph/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /New manual issue/ })).toBeVisible();
  });
});

test.describe("graph & issues (real gaps)", () => {
  test("real gap-analysis findings drive the AI-issues pane (Phase 3)", async ({ page }) => {
    await mock(page);
    // Override the empty gaps with real findings.
    await page.route("**/api/brain/gaps**", (r) =>
      r.fulfill({ json: { gaps: [
        { id: "n0", kind: "orphan", label: "Lonely feature", detail: "This feature has no connections." },
        { id: "n1", kind: "unresolved-decision", label: "Adopt X", detail: "A proposed decision not yet accepted." },
      ] } }),
    );
    await page.goto("/graph-issues");
    const pane = page.getByTestId("gi-issues");
    await expect(pane.locator(".gi-issue")).toHaveCount(2); // 2 real gaps, not the 7 seeds
    await expect(pane).toContainText("Lonely feature");
    await expect(pane).toContainText("gap-analysis (orphan)");
  });
});
