import { test, expect, type Page } from "@playwright/test";

/**
 * Gate is REAL — driven by human gates (brakes) and a real brain conflict.
 * No brake → honest empty state. A real brake hydrates the Task/Why cards; a
 * real conflict drives the two-panel decision conflict. No seeded narrative,
 * no fake ADR-014 / diff / signal cards.
 */
async function mock(page: Page, brakes: unknown[] = []) {
  await page.route("**/api/brakes", (r) => r.fulfill({ json: { brakes } }));
  await page.route("**/api/projects", (r) =>
    r.fulfill({ json: { projects: [{ id: "p1", name: "Demo", path: "/d", account_strategy: "round_robin", model_ceiling: null, autopilot: 0, created_at: "" }] } }),
  );
  await page.route("**/api/gate/conflict**", (r) => r.fulfill({ json: { conflict: null } }));
}

test.describe("gate (real)", () => {
  test("no brake → honest empty state", async ({ page }) => {
    await mock(page);
    await page.goto("/gate");
    await expect(page.locator("body")).toContainText("No human gates right now.");
    await expect(page.getByTestId("gate-conflict")).toHaveCount(0);
  });

  test("a real brake hydrates the task card", async ({ page }) => {
    await mock(page, [
      { id: "b1", mission: "SPD-200 · Ship the new pricing page", brake: "wants a human call before merge", detail: "proposed a schema change.", worker: "sess_xyz" },
    ]);
    await page.goto("/gate");
    const screen = page.getByTestId("gate-conflict");
    await expect(screen).toBeVisible();
    await expect(screen).toContainText("SPD-200 · Ship the new pricing page");
    await expect(screen).toContainText("sess_xyz");
    await expect(screen).toContainText("wants a human call before merge");
    await expect(screen.getByRole("button", { name: /Approve & resume/ })).toBeVisible();
    // No real conflict → the no-conflict note, not a seeded ADR conflict.
    await expect(page.getByTestId("gate-no-conflict")).toBeVisible();
  });

  test("a real brain conflict drives the two conflict panels", async ({ page }) => {
    await mock(page, [
      { id: "b1", mission: "SPD-201", brake: "conflicts with an active decision", detail: "", worker: "sess_a" },
    ]);
    await page.route("**/api/gate/conflict**", (r) =>
      r.fulfill({ json: { conflict: {
        existing: { id: "d1", label: "Use server-side rendering", detail: "Chosen for SEO.", owner: "Akira" },
        proposed: { id: "d2", label: "Move to client-side rendering", detail: "Faster iteration.", owner: "Robert" },
      } } }),
    );
    await page.goto("/gate");
    await expect(page.getByTestId("conflict-existing")).toHaveText("Use server-side rendering");
    await expect(page.getByTestId("conflict-proposed")).toHaveText("Move to client-side rendering");
  });
});
