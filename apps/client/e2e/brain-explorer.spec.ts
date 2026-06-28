import { test, expect, type Page } from "@playwright/test";

/**
 * PR-05 — Brain Explorer (3-column detail-first layout).
 * Verifies the namespace tree / record detail / relations map structure, tree
 * selection, relation navigation, and the Explorer↔Graph subtab switch.
 * Drives the data path with mocked API responses (no backend).
 */

const NODES = [
  // f1 carries real provenance (Phase 3) — owner/source/updated_at win over the seed.
  { id: "f1", type: "feature", label: "Checkout", owner: "Akira Real", source: "Sprint Planning Real", updated_at: "2026-03-25T10:00:00Z" },
  { id: "f2", type: "feature", label: "Search" },
  { id: "d1", type: "decision", label: "Use Stripe PaymentIntent" },
  { id: "b1", type: "bug", label: "Carousel jank" },
  { id: "u1", type: "feedback", label: "Checkout slow on mobile" },
].map((n, i) => ({
  ...n,
  project_id: "p1",
  detail: n.type === "feature" ? `${n.label} detail prose.` : null,
  x: 80 + i * 80,
  y: 100,
  created_at: "2026-01-01T00:00:00Z",
}));

const EDGES = [
  ["f1", "d1"],
  ["f1", "b1"],
  ["f1", "u1"],
  ["f2", "d1"],
].map(([from_id, to_id], i) => ({ id: `e${i}`, project_id: "p1", from_id, to_id, rel: null }));

async function mockBrain(page: Page) {
  await page.route("**/api/projects", (r) =>
    r.fulfill({
      json: {
        projects: [
          { id: "p1", name: "Demo", path: "/demo", account_strategy: "round_robin", model_ceiling: null, autopilot: 0, created_at: "" },
        ],
      },
    }),
  );
  await page.route("**/api/brain/nodes**", (r) => r.fulfill({ json: { nodes: NODES } }));
  await page.route("**/api/brain/edges**", (r) => r.fulfill({ json: { edges: EDGES } }));
  await page.route("**/api/tasks**", (r) => r.fulfill({ json: { tasks: [] } }));
}

test.describe("brain explorer", () => {
  test.beforeEach(async ({ page }) => {
    await mockBrain(page);
    await page.goto("/brain");
    await expect(page.locator(".brain-explorer")).toBeVisible();
  });

  test("renders the three explorer columns", async ({ page }) => {
    await expect(page.locator(".brain-explorer .bx-tree")).toBeVisible();
    await expect(page.locator(".brain-explorer .bx-detail")).toBeVisible();
    await expect(page.locator(".brain-explorer .bx-relations")).toBeVisible();
  });

  test("defaults to the first feature and shows the rich record", async ({ page }) => {
    await expect(page.locator(".bx-title")).toHaveText("Checkout");
    // Rich keys grid (Type real + seeded owner/source/confidence/coverage).
    await expect(page.locator(".bx-keys .k")).toHaveText([
      "Type", "Owner", "Last touched", "Source", "Confidence", "Coverage",
    ]);
    await expect(page.locator(".bx-prose")).toContainText("Checkout detail prose.");
  });

  test("shows the rich record sections (code surface, activity, MCP)", async ({ page }) => {
    await expect(page.locator(".bx-detail")).toContainText("Code surface");
    await expect(page.locator(".bx-detail .bx-files .bx-file").first()).toBeVisible();
    await expect(page.locator(".bx-detail")).toContainText("Activity");
    await expect(page.locator(".bx-detail .bx-activity .bx-evt").first()).toBeVisible();
    await expect(page.getByTestId("mcp-block")).toContainText("MCP server");
  });

  test("page head has the search + Find gaps + Export to MCP actions", async ({ page }) => {
    await expect(page.locator(".brain-search input")).toBeVisible();
    // Find gaps is now a link to /graph-issues (Phase 3); Export to MCP is a button.
    await expect(page.getByTestId("find-gaps")).toHaveAttribute("href", "/graph-issues");
    await expect(page.getByRole("button", { name: /Export to MCP/ })).toBeVisible();
  });

  test("selecting a tree feature updates the center record", async ({ page }) => {
    await page.locator('.bx-feature[data-id="f2"]').click();
    await expect(page.locator(".bx-title")).toHaveText("Search");
  });

  test("relations list navigates to a neighbor", async ({ page }) => {
    // f1 (Checkout) neighbours include the decision d1.
    const relItem = page.locator('.bx-rel-item[data-id="d1"]');
    await expect(relItem).toBeVisible();
    await relItem.click();
    await expect(page.locator(".bx-title")).toHaveText("Use Stripe PaymentIntent");
  });

  test("anchor diagram shows the selected node's glyph", async ({ page }) => {
    await expect(page.locator(".bx-anchor-center")).toContainText("F"); // feature glyph
    await expect(page.locator(".bx-anchor-label")).toHaveText("Checkout");
  });

  test("Brain is Explorer-only — no Graph subtab (graph lives at /graph-issues)", async ({ page }) => {
    await expect(page.locator(".subtab", { hasText: "Graph" })).toHaveCount(0);
    await expect(page.locator(".brain-explorer")).toBeVisible();
  });

  test("real provenance (owner/source/last-touched) wins over the seed (Phase 3)", async ({ page }) => {
    // Default selection is f1, which carries real columns.
    await expect(page.getByTestId("bx-owner")).toHaveText("Akira Real");
    await expect(page.getByTestId("bx-source")).toHaveText("Sprint Planning Real");
    await expect(page.getByTestId("bx-touched")).toContainText("Mar 25, 2026"); // from updated_at
  });

  test("Export to MCP fetches the real manifest summary (Phase 3)", async ({ page }) => {
    await page.route("**/api/brain/export**", (r) =>
      r.fulfill({ json: { project_id: "p1", node_count: 42, edge_count: 99, by_type: {}, resources: [] } }),
    );
    await page.getByTestId("export-mcp").click();
    await expect(page.getByTestId("mcp-result")).toContainText("Exported 42 nodes · 99 edges");
  });
});
