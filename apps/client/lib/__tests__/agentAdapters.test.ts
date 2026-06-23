import { describe, expect, test } from "vitest";
import { sessionStatusVisual } from "../adapters";
import type { Session } from "../types";

function session(over: Partial<Session> = {}): Session {
  return {
    id: "s1",
    name: "agent-1",
    alive: true,
    cmd: "claude",
    cwd: "/work",
    role: "developer",
    label: null,
    emoji: null,
    mode: null,
    prep: "ready",
    prep_detail: null,
    task: null,
    order: null,
    model: "opus",
    mission: null,
    parent: null,
    reason: null,
    state: "running",
    harness_state: null,
    has_menu: false,
    account_id: null,
    project_id: null,
    ...over,
  };
}

describe("sessionStatusVisual", () => {
  test("dead session (alive=false) is muted regardless of prep", () => {
    const v = sessionStatusVisual(session({ alive: false, prep: "ready" }));
    expect(v.label).toBe("dead");
    expect(v.color).toBe("var(--text-4)");
  });

  test("prep=error maps to red error", () => {
    const v = sessionStatusVisual(session({ prep: "error" }));
    expect(v.label).toBe("error");
    expect(v.color).toBe("var(--red)");
  });

  test("prep=working maps to blue working", () => {
    const v = sessionStatusVisual(session({ prep: "working" }));
    expect(v.label).toBe("working");
    expect(v.color).toBe("var(--blue)");
  });

  test("prep=ready maps to green ready", () => {
    const v = sessionStatusVisual(session({ prep: "ready" }));
    expect(v.label).toBe("ready");
    expect(v.color).toBe("var(--green)");
  });

  test("prep=booting maps to amber", () => {
    const v = sessionStatusVisual(session({ prep: "booting" }));
    expect(v.label).toBe("booting");
    expect(v.color).toBe("var(--amber)");
  });

  test("prep=priming maps to amber", () => {
    const v = sessionStatusVisual(session({ prep: "priming" }));
    expect(v.label).toBe("priming");
    expect(v.color).toBe("var(--amber)");
  });

  test("null prep on a live session falls back to the raw state, muted color", () => {
    const v = sessionStatusVisual(session({ prep: null, state: "idle" }));
    expect(v.label).toBe("idle");
    expect(v.color).toBe("var(--text-3)");
  });
});
