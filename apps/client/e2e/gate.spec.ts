import { test, expect, type Page } from "@playwright/test";

/**
 * Gate is REAL — driven by human gates (brakes) and a real brain conflict.
 * No brake → honest empty state. A real brake hydrates the Task/Why cards; a
 * real conflict drives the two-panel decision conflict. No seeded narrative,
 * no fake ADR-014 / diff / signal cards.
 */
async function mock(page: Page, brakes: unknown[] = [], gates: unknown[] = []) {
  await page.route("**/api/brakes", (r) => r.fulfill({ json: { brakes } }));
  await page.route("**/api/projects", (r) =>
    r.fulfill({ json: { projects: [{ id: "p1", name: "Demo", path: "/d", account_strategy: "round_robin", model_ceiling: null, autopilot: 0, created_at: "" }] } }),
  );
  await page.route("**/api/gate/conflict**", (r) => r.fulfill({ json: { conflict: null } }));
  await page.route("**/api/projects/*/gates", (r) => r.fulfill({ json: { gates } }));
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

  test("a lifecycle gate renders with no brake present, and Approve calls the endpoint", async ({ page }) => {
    let approved = false;
    await mock(page, [], [
      { id: "g1", task_id: "T-9", run_id: "r9", gate: "plan", status: "waiting", comment: null, decided_by: null, decided_at: null, created_at: "", task_title: "Ship the roadmap", phase: "plan_review" },
    ]);
    await page.route("**/api/tasks/*/gates/*/approve", (r) => {
      approved = true;
      return r.fulfill({ json: { id: "r9", project_id: "p1", task_id: "T-9", phase: "building", active: 1 } });
    });
    await page.goto("/gate");
    // No brake → the brake wrap is absent, but the lifecycle gate still renders.
    await expect(page.getByTestId("gate-conflict")).toHaveCount(0);
    const card = page.getByTestId("lifecycle-gate-card");
    await expect(card).toBeVisible();
    await expect(card).toContainText("Plan review");
    await expect(card).toContainText("Ship the roadmap");
    await card.getByTestId("lifecycle-gate-approve").click();
    await expect.poll(() => approved).toBe(true);
  });

  test("lifecycle gates render alongside a brake", async ({ page }) => {
    await mock(page, [
      { id: "b1", mission: "SPD-300", brake: "wants a human call", detail: "", worker: "sess_z" },
    ], [
      { id: "g1", task_id: "T-9", run_id: "r9", gate: "merge", status: "waiting", comment: null, decided_by: null, decided_at: null, created_at: "", task_title: "Merge auth", phase: "pr_review" },
    ]);
    await page.goto("/gate");
    await expect(page.getByTestId("gate-conflict")).toBeVisible();
    await expect(page.getByTestId("lifecycle-gate-card")).toBeVisible();
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
