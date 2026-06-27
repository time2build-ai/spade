import { test, expect, type Page } from "@playwright/test";

/**
 * PR-05 — Brain Explorer (3-column detail-first layout).
 * Verifies the namespace tree / record detail / relations map structure, tree
 * selection, relation navigation, and the Explorer↔Graph subtab switch.
 * Drives the data path with mocked API responses (no backend).
 */

const NODES = [
  { id: "f1", type: "feature", label: "Checkout" },
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

  test("defaults to the first feature and shows its record", async ({ page }) => {
    await expect(page.locator(".bx-title")).toHaveText("Checkout");
    // Keys grid shows the 3 honest fields.
    await expect(page.locator(".bx-keys .k")).toHaveText(["Type", "Created", "Edges"]);
    await expect(page.locator(".bx-prose")).toContainText("Checkout detail prose.");
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

  test("Explorer↔Graph subtabs switch the view", async ({ page }) => {
    await expect(page.locator(".subtab.active")).toHaveText("Explorer");
    await page.locator(".subtab", { hasText: "Graph" }).click();
    await expect(page.locator(".brain-wrap")).toBeVisible();
    await expect(page.locator(".brain-explorer")).toHaveCount(0);
    await page.locator(".subtab", { hasText: "Explorer" }).click();
    await expect(page.locator(".brain-explorer")).toBeVisible();
  });
});
