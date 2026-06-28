import { test, expect, type Page } from "@playwright/test";

/**
 * PR-06 — Backlog parity.
 * Four columns (blocked routed to an amber banner, not a 5th column), the
 * blocked banner, and the "Run sprint" head action. Mocks the API.
 */

const TASKS = [
  ["T-1", "ready", "Ready task"],
  ["T-2", "in_progress", "WIP task"],
  ["T-3", "review", "Review task"],
  ["T-4", "shipped", "Shipped task"],
  ["T-5", "blocked", "Blocked task"],
].map(([id, status, title]) => ({
  id,
  project_id: "p1",
  title,
  feature: "Checkout",
  priority: 1,
  status,
  origin_quote: null,
  origin_source: null,
  description: null,
  created_at: "2026-01-01T00:00:00Z",
  nodes: id === "T-1" ? ["bn-f", "bn-b", "bn-d"] : [],
  links: [],
}));

const BRAIN_NODES = [
  { id: "bn-f", project_id: "p1", type: "feedback", label: "slow checkout", detail: null, x: null, y: null, created_at: null },
  { id: "bn-b", project_id: "p1", type: "bug", label: "carousel jank", detail: null, x: null, y: null, created_at: null },
  { id: "bn-d", project_id: "p1", type: "decision", label: "use stripe", detail: null, x: null, y: null, created_at: null },
];

async function mockBacklog(page: Page) {
  await page.route("**/api/projects", (r) =>
    r.fulfill({
      json: {
        projects: [
          { id: "p1", name: "Demo", path: "/demo", account_strategy: "round_robin", model_ceiling: null, autopilot: 0, created_at: "" },
        ],
      },
    }),
  );
  await page.route("**/api/tasks**", (r) => r.fulfill({ json: { tasks: TASKS } }));
  await page.route("**/api/brain/nodes**", (r) => r.fulfill({ json: { nodes: BRAIN_NODES } }));
}

test.describe("backlog", () => {
  test.beforeEach(async ({ page }) => {
    await mockBacklog(page);
    await page.goto("/backlog");
    await expect(page.locator(".backlog-grid")).toBeVisible();
  });

  test("renders exactly 4 columns, no Blocked column", async ({ page }) => {
    await expect(page.locator(".backlog-grid .col")).toHaveCount(4);
    for (const label of ["Ready", "In progress", "Review", "Shipped"]) {
      await expect(page.locator(".col-head", { hasText: label })).toHaveCount(1);
    }
    await expect(page.locator(".col-head", { hasText: "Blocked" })).toHaveCount(0);
  });

  test("blocked tasks surface in the amber banner with a gate link", async ({ page }) => {
    const banner = page.getByTestId("blocked-banner");
    await expect(banner).toBeVisible();
    await expect(banner).toContainText("T-5");
    await expect(banner.getByRole("link", { name: /Open gate/ })).toHaveAttribute("href", "/gate");
  });

  test("the blocked task is not placed in any column", async ({ page }) => {
    await expect(page.locator(".backlog-grid").getByText("Blocked task")).toHaveCount(0);
  });

  test('"Run sprint" head action links to the orchestrator', async ({ page }) => {
    await expect(page.getByRole("link", { name: /Run sprint/ })).toHaveAttribute("href", "/orchestrator");
  });

  test("each column shows its task count", async ({ page }) => {
    // Ready/In progress/Review/Shipped each have exactly one task here.
    for (const label of ["Ready", "In progress", "Review", "Shipped"]) {
      const head = page.locator(".col-head", { hasText: label });
      await expect(head.locator(".count")).toHaveText("1");
    }
  });

  test("columns fill the height (not tightly wrapping the card)", async ({ page }) => {
    const col = page.locator(".backlog-grid .col").first();
    const box = (await col.boundingBox())!;
    // A single short card sits in a column that still stretches tall.
    expect(box.height).toBeGreaterThan(300);
  });

  test("rich card shows intel chips from linked nodes with reference wording", async ({ page }) => {
    const card = page.locator('[data-testid="task-card"]', { hasText: "Ready task" });
    await expect(card.locator(".intel-bar")).toBeVisible();
    await expect(card.locator(".chip.feedback")).toContainText("1 feedback");
    await expect(card.locator(".chip.bug")).toContainText("1 bug");
    await expect(card.locator(".chip.decision")).toContainText("1 ADR"); // "ADR" not "decision"
  });

  test("cards show an assignee avatar", async ({ page }) => {
    await expect(page.locator('[data-testid="task-card"] .tc-foot .avatar').first()).toBeVisible();
  });

  test("blocked banner names the conflicting ADR", async ({ page }) => {
    await expect(page.getByTestId("blocked-banner")).toContainText("Reviewer flagged conflict");
    await expect(page.getByTestId("banner-adr")).toContainText("ADR-014");
  });
});
