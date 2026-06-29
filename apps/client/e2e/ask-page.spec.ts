import { test, expect, type Page } from "@playwright/test";

/**
 * /ask is REAL — thread list + chat panel come from the API (no DEMO_THREADS).
 * The context rail shows the real project name; empty projects get an honest
 * "no saved threads" state pointing at the Ask companion.
 */
const PROJECT = { id: "p1", name: "Demo", path: "/d", account_strategy: "round_robin", model_ceiling: null, autopilot: 0, created_at: "" };

async function mock(page: Page, opts: { threads?: object[]; messages?: object[] }) {
  await page.route("**/api/projects", (r) => r.fulfill({ json: { projects: [PROJECT] } }));
  await page.route("**/api/chat/threads?**", (r) => r.fulfill({ json: { threads: opts.threads ?? [] } }));
  await page.route("**/api/chat/threads/*/messages", (r) => r.fulfill({ json: { messages: opts.messages ?? [] } }));
}

test.describe("ask page (real API)", () => {
  test("project with no threads → honest empty state", async ({ page }) => {
    await mock(page, { threads: [] });
    await page.goto("/ask");
    await expect(page.getByTestId("ask-page")).toBeVisible();
    await expect(page.getByTestId("ask-thread")).toHaveCount(0);
    await expect(page.getByTestId("ask-threads-empty")).toContainText("No saved threads yet");
    await expect(page.getByTestId("ask-threads-empty")).toContainText("Ask companion");
    // Rail shows the real project name, not a fabricated model/sprint.
    const rail = page.locator(".ask-rail");
    await expect(rail).toContainText("Project");
    await expect(rail).toContainText("Demo");
    await expect(rail).not.toContainText("claude-opus-4");
  });

  test("real persisted threads + messages render", async ({ page }) => {
    await mock(page, {
      threads: [
        { id: "th-real", project_id: "p1", title: "Real DB thread", pinned: 1, updated_at: "2026-04-01T09:00:00Z", created_at: "" },
      ],
      messages: [
        { id: "m1", thread_id: "th-real", role: "user", who: "Robert", text: "Persisted question?", payload: null, created_at: "2026-04-01T09:00:00Z" },
        { id: "m2", thread_id: "th-real", role: "assistant", who: "Spade", text: "Persisted answer.", payload: { plan: { title: "Real plan", steps: ["one", "two"] }, cites: ["fb-9"] }, created_at: "2026-04-01T09:01:00Z" },
      ],
    });
    await page.goto("/ask");
    await expect(page.getByTestId("ask-page")).toBeVisible();
    await expect(page.getByTestId("ask-threads-empty")).toHaveCount(0);
    await expect(page.getByTestId("ask-thread")).toHaveCount(1);
    await expect(page.locator(".ch-title")).toHaveText("Real DB thread");
    await expect(page.locator(".ch-stream")).toContainText("Persisted answer.");
    // Structured payload → real plan card + citation pill.
    await expect(page.getByTestId("ch-plan")).toContainText("Real plan");
    await expect(page.locator(".ch-cite").first()).toContainText("fb-9");
  });

  test("search narrows the thread list", async ({ page }) => {
    await mock(page, {
      threads: [
        { id: "t1", project_id: "p1", title: "Conversion drop investigation", pinned: 1, updated_at: "2026-04-01T09:00:00Z", created_at: "" },
        { id: "t2", project_id: "p1", title: "Sprint standup summary", pinned: 0, updated_at: "2026-04-01T09:00:00Z", created_at: "" },
      ],
    });
    await page.goto("/ask");
    await expect(page.getByTestId("ask-thread")).toHaveCount(2);
    await page.locator(".ask-threads-search input").fill("conversion");
    await expect(page.getByTestId("ask-thread")).toHaveCount(1);
    await expect(page.getByTestId("ask-thread")).toContainText("Conversion drop");
  });

  test("context rail shows the real project name", async ({ page }) => {
    await mock(page, {
      threads: [
        { id: "t1", project_id: "p1", title: "Thread one", pinned: 0, updated_at: "2026-04-01T09:00:00Z", created_at: "" },
      ],
    });
    await page.goto("/ask");
    const rail = page.locator(".ask-rail");
    await expect(rail).toContainText("Project");
    await expect(rail).toContainText("Demo");
    await expect(rail).not.toContainText("claude-opus-4");
  });
});
