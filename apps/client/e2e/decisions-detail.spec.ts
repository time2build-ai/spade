import { test, expect, type Page } from "@playwright/test";

/**
 * PR-12 — ADR detail re-docked from a centered modal to a right-side aside.
 * No-fabrication: content is unchanged real data (label, recorded date, the
 * markdown detail, linked work + connections from real edges/tasks); only the
 * container layout moves. The reference's status filter tabs + status pills
 * (PR-11) stay deferred — decisions (type=decision brain nodes) have no status
 * field in the API. Mocks the API.
 */

const NODES = [
  { id: "d1", project_id: "p1", type: "decision", label: "Use Stripe PaymentIntent", detail: "## Context\nWe standardise on Stripe.", x: null, y: null, created_at: "2026-01-01T00:00:00Z" },
];

async function mockDecisions(page: Page) {
  await page.route("**/api/projects", (r) =>
    r.fulfill({ json: { projects: [{ id: "p1", name: "Demo", path: "/demo", account_strategy: "round_robin", model_ceiling: null, autopilot: 0, created_at: "" }] } }),
  );
  await page.route("**/api/brain/nodes**", (r) => r.fulfill({ json: { nodes: NODES } }));
  await page.route("**/api/brain/edges**", (r) => r.fulfill({ json: { edges: [] } }));
  await page.route("**/api/tasks**", (r) => r.fulfill({ json: { tasks: [] } }));
}

test.describe("decision detail aside", () => {
  test.beforeEach(async ({ page }) => {
    await mockDecisions(page);
    await page.goto("/decisions");
    await expect(page.locator(".decisions-list")).toBeVisible();
  });

  test("opening a decision shows a right-docked aside with the real content", async ({ page }) => {
    await expect(page.getByTestId("decision-aside")).toHaveCount(0);
    await page.locator(".decisions-list").getByText("Use Stripe PaymentIntent").click();

    const aside = page.getByTestId("decision-aside");
    await expect(aside).toBeVisible();
    await expect(aside).toContainText("Use Stripe PaymentIntent");
    await expect(aside).toContainText("We standardise on Stripe.");

    // Docked to the right edge: its right edge meets the viewport width and it
    // starts in the right half of the screen.
    const box = (await aside.boundingBox())!;
    const vw = page.viewportSize()!.width;
    expect(box.x).toBeGreaterThan(vw / 2);
    expect(box.x + box.width).toBeGreaterThan(vw - 2);
  });

  test("Escape closes the aside", async ({ page }) => {
    await page.locator(".decisions-list").getByText("Use Stripe PaymentIntent").click();
    await expect(page.getByTestId("decision-aside")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("decision-aside")).toHaveCount(0);
  });

  test("aside has a TOC + structured sections", async ({ page }) => {
    await page.locator(".decisions-list").getByText("Use Stripe PaymentIntent").click();
    const aside = page.getByTestId("decision-aside");
    await expect(aside.getByTestId("adr-toc")).toBeVisible();
    for (const s of ["Summary", "Decision drivers", "Consequences", "Alternatives", "Validation", "Provenance", "Changelog"]) {
      await expect(aside).toContainText(s);
    }
    await expect(aside.locator(".adr-cons")).toBeVisible(); // 3-col consequences
  });
});
