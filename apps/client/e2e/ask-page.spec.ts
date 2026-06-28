import { test, expect } from "@playwright/test";

/**
 * V2 Phase 1 — full /ask page: thread list (search + pinned/recent), chat panel
 * with rich messages (cites / plan / ADR-EDIT diff cards), context rail. Seeded.
 */
test.describe("ask page", () => {
  test.beforeEach(async ({ page }) => {
    // No real chat threads → the page falls back to DEMO_THREADS. Stub the
    // project + empty thread list so these don't depend on proxy timing.
    await page.route("**/api/projects", (r) =>
      r.fulfill({ json: { projects: [{ id: "p1", name: "Demo", path: "/d", account_strategy: "round_robin", model_ceiling: null, autopilot: 0, created_at: "" }] } }),
    );
    await page.route("**/api/chat/threads?**", (r) => r.fulfill({ json: { threads: [] } }));
    await page.goto("/ask");
    await expect(page.getByTestId("ask-page")).toBeVisible();
  });

  test("thread list with search + pinned/recent groups", async ({ page }) => {
    await expect(page.locator(".ask-threads-group", { hasText: "Pinned" })).toBeVisible();
    await expect(page.locator(".ask-threads-group", { hasText: "Recent" })).toBeVisible();
    await expect(page.getByTestId("ask-thread").first()).toBeVisible();
    // Search narrows the list.
    await page.locator(".ask-threads-search input").fill("conversion");
    await expect(page.getByTestId("ask-thread")).toHaveCount(1);
  });

  test("selecting a thread loads its messages", async ({ page }) => {
    await page.getByTestId("ask-thread").filter({ hasText: "Sprint 26 standup" }).click();
    await expect(page.locator(".ch-title")).toHaveText("Sprint 26 standup summary");
    await expect(page.locator(".ch-stream .ch-msg").first()).toBeVisible();
  });

  test("rich messages render a plan card and an ADR-EDIT diff card", async ({ page }) => {
    // th-1 (default) has the ADR-EDIT action; th-2 has the plan.
    await expect(page.getByTestId("ch-action").first()).toBeVisible();
    await expect(page.getByTestId("ch-action")).toContainText("ADR-EDIT");
    await expect(page.locator(".ch-diff-line.add").first()).toBeVisible();
    await page.getByTestId("ask-thread").filter({ hasText: "conversion" }).click();
    await expect(page.getByTestId("ch-plan")).toBeVisible();
    await expect(page.locator(".ch-cite").first()).toBeVisible();
  });

  test("context rail shows project + model", async ({ page }) => {
    const rail = page.locator(".ask-rail");
    await expect(rail).toContainText("Project");
    await expect(rail).toContainText("claude-opus-4");
  });
});

test.describe("ask page (real API)", () => {
  test("real persisted threads + messages win over the seed (Phase 3)", async ({ page }) => {
    await page.route("**/api/projects", (r) =>
      r.fulfill({ json: { projects: [{ id: "p1", name: "Demo", path: "/d", account_strategy: "round_robin", model_ceiling: null, autopilot: 0, created_at: "" }] } }),
    );
    await page.route("**/api/chat/threads?**", (r) =>
      r.fulfill({ json: { threads: [
        { id: "th-real", project_id: "p1", title: "Real DB thread", pinned: 1, updated_at: "2026-04-01T09:00:00Z", created_at: "" },
      ] } }),
    );
    await page.route("**/api/chat/threads/th-real/messages", (r) =>
      r.fulfill({ json: { messages: [
        { id: "m1", thread_id: "th-real", role: "user", who: "Robert", text: "Persisted question?", payload: null, created_at: "2026-04-01T09:00:00Z" },
        { id: "m2", thread_id: "th-real", role: "assistant", who: "Spade", text: "Persisted answer.", payload: { plan: { title: "Real plan", steps: ["one", "two"] }, cites: ["fb-9"] }, created_at: "2026-04-01T09:01:00Z" },
      ] } }),
    );
    await page.goto("/ask");
    await expect(page.getByTestId("ask-page")).toBeVisible();
    await expect(page.getByTestId("ask-thread")).toHaveCount(1);
    await expect(page.locator(".ch-title")).toHaveText("Real DB thread");
    await expect(page.locator(".ch-stream")).toContainText("Persisted answer.");
    // Structured payload → real plan card + citation pill.
    await expect(page.getByTestId("ch-plan")).toContainText("Real plan");
    await expect(page.locator(".ch-cite").first()).toContainText("fb-9");
  });
});
