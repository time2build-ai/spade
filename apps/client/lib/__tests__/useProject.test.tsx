import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveActiveProject } from "@/lib/useProject";
import type { Project } from "@/lib/types";

function makeProject(id: string, name = id): Project {
  return {
    id,
    name,
    path: `/tmp/${id}`,
    account_strategy: "round_robin",
    model_ceiling: null,
    autopilot: 0,
    created_at: "2026-01-01",
  };
}

const A = makeProject("a");
const B = makeProject("b");
const C = makeProject("c");

describe("resolveActiveProject", () => {
  it("(a) empty storage -> first project chosen", () => {
    expect(resolveActiveProject([A, B, C], null)).toBe(A);
  });

  it("(b) stored id present in list -> honored", () => {
    expect(resolveActiveProject([A, B, C], "b")).toBe(B);
  });

  it("(c) stored id NOT in list -> falls back to first", () => {
    expect(resolveActiveProject([A, B, C], "zzz")).toBe(A);
  });

  it("(d) empty project list -> null", () => {
    expect(resolveActiveProject([], "a")).toBe(null);
    expect(resolveActiveProject([], null)).toBe(null);
  });
});

describe("useProject (hook)", () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
  });

  it("selects the first project when storage is empty", async () => {
    vi.doMock("@/lib/api", () => ({
      api: { projects: vi.fn().mockResolvedValue({ projects: [A, B, C] }) },
    }));
    const { renderHook, waitFor } = await import("@testing-library/react");
    const { useProject } = await import("@/lib/useProject");

    const { result } = renderHook(() => useProject());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.project?.id).toBe("a");
    expect(result.current.projects).toHaveLength(3);
  });

  it("honors a stored id that exists in the list", async () => {
    localStorage.setItem("spade.projectId", "b");
    vi.doMock("@/lib/api", () => ({
      api: { projects: vi.fn().mockResolvedValue({ projects: [A, B, C] }) },
    }));
    const { renderHook, waitFor } = await import("@testing-library/react");
    const { useProject } = await import("@/lib/useProject");

    const { result } = renderHook(() => useProject());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.project?.id).toBe("b");
  });

  it("setProject persists to localStorage and updates active id", async () => {
    vi.doMock("@/lib/api", () => ({
      api: { projects: vi.fn().mockResolvedValue({ projects: [A, B, C] }) },
    }));
    const { renderHook, waitFor, act } = await import(
      "@testing-library/react"
    );
    const { useProject } = await import("@/lib/useProject");

    const { result } = renderHook(() => useProject());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.setProject("c"));
    expect(result.current.project?.id).toBe("c");
    expect(localStorage.getItem("spade.projectId")).toBe("c");
  });

  it("setProject propagates across SEPARATE consumers (shared store)", async () => {
    vi.doMock("@/lib/api", () => ({
      api: { projects: vi.fn().mockResolvedValue({ projects: [A, B, C] }) },
    }));
    const { renderHook, waitFor, act } = await import("@testing-library/react");
    const { useProject } = await import("@/lib/useProject");

    const one = renderHook(() => useProject()); // e.g. the topbar switcher
    const two = renderHook(() => useProject()); // e.g. the sidebar
    await waitFor(() => expect(one.result.current.loading).toBe(false));
    await waitFor(() => expect(two.result.current.loading).toBe(false));

    act(() => one.result.current.setProject("c"));
    expect(one.result.current.project?.id).toBe("c");
    // The other consumer must reflect the change too (the bug we fixed).
    expect(two.result.current.project?.id).toBe("c");
  });
});
