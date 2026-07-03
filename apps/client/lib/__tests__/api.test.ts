import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";

function mockFetch(payload: unknown, ok = true, status = 200) {
  const fn = vi.fn().mockResolvedValue({
    ok,
    status,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe("api client", () => {
  it("prefixes requests with /api and JSON content-type", async () => {
    const fetchMock = mockFetch({ projects: [] });
    await api.projects();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects",
      expect.objectContaining({
        headers: expect.objectContaining({ "Content-Type": "application/json" }),
      }),
    );
  });

  it("encodes the project_id query param for tasks", async () => {
    const fetchMock = mockFetch({ tasks: [] });
    await api.tasks("p 1&x");
    expect(fetchMock.mock.calls[0][0]).toBe("/api/tasks?project_id=p%201%26x");
  });

  it("POSTs the status body when moving a task", async () => {
    const fetchMock = mockFetch({ id: "SPD-1" });
    await api.moveTask("SPD-1", "shipped");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/tasks/SPD-1/move");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ status: "shipped" }));
  });

  it("throws on a non-ok response", async () => {
    mockFetch("boom", false, 500);
    await expect(api.projects()).rejects.toThrow(/500/);
  });

  // -- Task-Type Router ------------------------------------------------------

  it("GETs the lifecycle templates mapping", async () => {
    const fetchMock = mockFetch({ templates: {}, gate_labels: {}, artifact_labels: {} });
    await api.templates();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/lifecycle/templates");
  });

  it("POSTs kind + doc_template when confirming a kind", async () => {
    const fetchMock = mockFetch({ id: "SPD-1" });
    await api.setKind("SPD-1", "docs", "sow");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/tasks/SPD-1/kind");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ kind: "docs", doc_template: "sow" }));
  });

  it("sends a null doc_template when omitted", async () => {
    const fetchMock = mockFetch({ id: "SPD-1" });
    await api.setKind("SPD-1", "research");
    expect(fetchMock.mock.calls[0][1].body).toBe(
      JSON.stringify({ kind: "research", doc_template: null }),
    );
  });

  it("POSTs to route-untyped for a project", async () => {
    const fetchMock = mockFetch({ project_id: "p1", routed: 3 });
    await api.routeUntyped("p1");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/projects/p1/route-untyped");
    expect(init.method).toBe("POST");
  });

  it("builds the /api/doc/{id} url (Next proxies /api/*)", () => {
    expect(api.docUrl("art-9")).toBe("/api/doc/art-9");
  });
});
