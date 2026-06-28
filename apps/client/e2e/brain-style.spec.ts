import { test, expect, type Page } from "@playwright/test";

/**
 * PR-04 — Brain node styling parity.
 * Verifies the feedback/metric color swap is fixed and that the shared typeMeta
 * (color + F/D/C/U/B/M glyph) drives both the legend swatches and the graph
 * nodes. Mirrors the reference typeMeta (Spade standalone, GraphIssuesView).
 * Drives the data path with mocked API responses (no backend needed).
 */

const TYPES = ["feature", "decision", "convention", "feedback", "bug", "metric"] as const;

// token hex → resolved rgb (what toHaveCSS returns).
const RGB: Record<(typeof TYPES)[number], string> = {
  feature: "rgb(201, 184, 255)", // --accent #c9b8ff
  decision: "rgb(230, 184, 106)", // --amber  #e6b86a
  convention: "rgb(230, 155, 182)", // --pink   #e69bb6
  feedback: "rgb(122, 220, 199)", // --teal   #7adcc7  (was wrongly blue)
  bug: "rgb(232, 125, 125)", // --red    #e87d7d
  metric: "rgb(122, 182, 230)", // --blue   #7ab6e6  (was wrongly teal)
};
const GLYPH: Record<(typeof TYPES)[number], string> = {
  feature: "F",
  decision: "D",
  convention: "C",
  feedback: "U",
  bug: "B",
  metric: "M",
};

async function mockBrain(page: Page) {
  await page.route("**/api/projects", (r) =>
    r.fulfill({
      json: {
        projects: [
          {
            id: "p1",
            name: "Demo",
            path: "/demo",
            account_strategy: "round_robin",
            model_ceiling: null,
            autopilot: 0,
            created_at: "",
          },
        ],
      },
    }),
  );
  await page.route("**/api/brain/nodes**", (r) =>
    r.fulfill({
      json: {
        nodes: TYPES.map((t, i) => ({
          id: `n-${t}`,
          project_id: "p1",
          type: t,
          label: `${t} node`,
          detail: null,
          x: 80 + i * 90,
          y: 80 + (i % 3) * 110,
          created_at: null,
        })),
      },
    }),
  );
  await page.route("**/api/brain/edges**", (r) => r.fulfill({ json: { edges: [] } }));
  await page.route("**/api/tasks**", (r) => r.fulfill({ json: { tasks: [] } }));
}

test.describe("brain node styling", () => {
  test.beforeEach(async ({ page }) => {
    await mockBrain(page);
    // The legend + graph nodes now live on the Graph & Issues route.
    await page.goto("/graph-issues");
    await expect(page.locator(".legend-dot").first()).toBeVisible();
  });

  for (const t of TYPES) {
    test(`legend "${t}" swatch is the right color and glyph`, async ({ page }) => {
      const dot = page.locator(`.legend-dot[data-type="${t}"]`);
      await expect(dot).toHaveCSS("background-color", RGB[t]);
      await expect(dot).toHaveText(GLYPH[t]);
    });
  }

  test("feedback and metric colors are not swapped", async ({ page }) => {
    // Regression guard for the specific bug this PR fixes.
    await expect(page.locator('.legend-dot[data-type="feedback"]')).toHaveCSS(
      "background-color",
      "rgb(122, 220, 199)",
    );
    await expect(page.locator('.legend-dot[data-type="metric"]')).toHaveCSS(
      "background-color",
      "rgb(122, 182, 230)",
    );
  });

  test("graph nodes render their type glyph", async ({ page }) => {
    for (const t of ["feedback", "metric", "feature"] as const) {
      await expect(page.locator(`text[data-glyph="${t}"]`)).toHaveText(GLYPH[t]);
    }
  });
});
