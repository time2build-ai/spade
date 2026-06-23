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
});
