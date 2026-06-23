import { describe, expect, it } from "vitest";
import {
  groupNodesByType,
  indexNodesById,
  projectColor,
  projectGlyph,
  projectSlug,
  resolveNodes,
  tasksByStatus,
} from "@/lib/adapters";
import { STATUSES } from "@/lib/types";
import type { BrainNode, BrainNodeType, Project, Task } from "@/lib/types";

const GLYPH_PALETTE = ["#c9b8ff", "#7ad19a", "#f0c674", "#9bd1f0"];

const NODE_TYPES: BrainNodeType[] = [
  "feature",
  "decision",
  "convention",
  "feedback",
  "bug",
  "metric",
];

function makeNode(id: string, type: BrainNodeType): BrainNode {
  return { id, project_id: "p1", type, label: id, detail: null, x: null, y: null };
}

function makeProject(over: Partial<Project> = {}): Project {
  return {
    id: "p1",
    name: "Acme",
    path: "/tmp/acme",
    account_strategy: "round_robin",
    model_ceiling: null,
    autopilot: 0,
    created_at: "2026-01-01",
    ...over,
  };
}

function makeTask(id: string, status: string): Task {
  return {
    id,
    project_id: "p1",
    title: id,
    feature: null,
    priority: 0,
    status: status as Task["status"],
    origin_quote: null,
    origin_source: null,
    description: null,
    created_at: "2026-01-01",
    nodes: [],
  };
}

describe("groupNodesByType", () => {
  it("groups mixed nodes by type and includes all 6 type keys", () => {
    const nodes = [
      makeNode("a", "feature"),
      makeNode("b", "feature"),
      makeNode("c", "bug"),
    ];
    const grouped = groupNodesByType(nodes);

    for (const t of NODE_TYPES) {
      expect(grouped).toHaveProperty(t);
      expect(Array.isArray(grouped[t])).toBe(true);
    }
    expect(grouped.feature.map((n) => n.id)).toEqual(["a", "b"]);
    expect(grouped.bug.map((n) => n.id)).toEqual(["c"]);
  });

  it("returns empty arrays for missing types", () => {
    const grouped = groupNodesByType([]);
    for (const t of NODE_TYPES) {
      expect(grouped[t]).toEqual([]);
    }
  });
});

describe("projectGlyph", () => {
  it("returns the first letter uppercased", () => {
    expect(projectGlyph(makeProject({ name: "Acme" }))).toBe("A");
    expect(projectGlyph(makeProject({ name: "spade" }))).toBe("S");
  });

  it("handles empty name gracefully", () => {
    expect(projectGlyph(makeProject({ name: "" }))).toBe("?");
  });
});

describe("projectColor", () => {
  it("returns a deterministic color for the same id", () => {
    const p = makeProject({ id: "abc" });
    expect(projectColor(p)).toBe(projectColor(p));
  });

  it("returns a color from the palette", () => {
    for (const id of ["a", "bb", "ccc", "dddd", "spade-1"]) {
      expect(GLYPH_PALETTE).toContain(projectColor(makeProject({ id })));
    }
  });

  it("varies across ids", () => {
    const colors = new Set(
      ["a", "b", "c", "d"].map((id) => projectColor(makeProject({ id }))),
    );
    expect(colors.size).toBeGreaterThan(1);
  });
});

describe("projectSlug", () => {
  it("kebab-cases a name with punctuation", () => {
    expect(projectSlug(makeProject({ name: "Hello Spade (PoC)" }))).toBe(
      "hello-spade-poc",
    );
  });

  it("handles simple names", () => {
    expect(projectSlug(makeProject({ name: "Acme" }))).toBe("acme");
    expect(projectSlug(makeProject({ name: "My  Cool   App" }))).toBe(
      "my-cool-app",
    );
  });
});

describe("tasksByStatus", () => {
  it("buckets tasks into all 5 statuses", () => {
    const tasks = [
      makeTask("SPD-1", "ready"),
      makeTask("SPD-2", "ready"),
      makeTask("SPD-3", "shipped"),
    ];
    const buckets = tasksByStatus(tasks);

    for (const s of STATUSES) {
      expect(buckets).toHaveProperty(s);
      expect(Array.isArray(buckets[s])).toBe(true);
    }
    expect(buckets.ready.map((t) => t.id)).toEqual(["SPD-1", "SPD-2"]);
    expect(buckets.shipped.map((t) => t.id)).toEqual(["SPD-3"]);
    expect(buckets.in_progress).toEqual([]);
  });

  it("ignores tasks with an unknown status", () => {
    const buckets = tasksByStatus([makeTask("SPD-9", "weird")]);
    for (const s of STATUSES) {
      expect(buckets[s]).toEqual([]);
    }
  });
});

describe("indexNodesById", () => {
  it("builds a lookup keyed by node id", () => {
    const a = makeNode("a", "feature");
    const b = makeNode("b", "bug");
    const index = indexNodesById([a, b]);
    expect(index.a).toBe(a);
    expect(index.b).toBe(b);
    expect(index.missing).toBeUndefined();
  });

  it("returns an empty object for no nodes", () => {
    expect(indexNodesById([])).toEqual({});
  });
});

describe("resolveNodes", () => {
  const a = makeNode("a", "feature");
  const b = makeNode("b", "bug");
  const c = makeNode("c", "decision");

  it("maps ids to BrainNodes preserving order", () => {
    const index = indexNodesById([a, b, c]);
    expect(resolveNodes(["c", "a"], index)).toEqual([c, a]);
  });

  it("drops ids with no matching node", () => {
    const index = indexNodesById([a, b]);
    expect(resolveNodes(["a", "zzz", "b"], index)).toEqual([a, b]);
  });

  it("returns an empty array when nothing matches", () => {
    expect(resolveNodes(["x", "y"], indexNodesById([a]))).toEqual([]);
    expect(resolveNodes([], indexNodesById([a]))).toEqual([]);
  });
});
