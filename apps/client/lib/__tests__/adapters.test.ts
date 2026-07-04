import { describe, expect, it } from "vitest";
import {
  BOARD_COLUMNS,
  columnFor,
  groupNodesByType,
  indexNodesById,
  projectColor,
  projectGlyph,
  projectSlug,
  resolveNodes,
  tasksByColumn,
  tasksByStatus,
} from "@/lib/adapters";
import { STATUSES } from "@/lib/types";
import type {
  BrainNode,
  BrainNodeType,
  Kind,
  LifecycleTemplates,
  Project,
  Task,
} from "@/lib/types";

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
    links: [],
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
    expect(buckets.building).toEqual([]);
  });

  it("ignores tasks with an unknown status", () => {
    const buckets = tasksByStatus([makeTask("SPD-9", "weird")]);
    for (const s of STATUSES) {
      expect(buckets[s]).toEqual([]);
    }
  });
});

const TEMPLATES: LifecycleTemplates = {
  templates: {
    code: {
      terminal_status: "shipped",
      columns: {
        shaping: "Planning",
        plan_review: "Planning",
        building: "In progress",
        pr_review: "Review",
        shipped: "Done",
      },
      phases: [],
    },
    research: {
      terminal_status: "delivered",
      columns: {
        scoping: "Planning",
        investigating: "In progress",
        synthesis: "Review",
        delivered: "Done",
      },
      phases: [],
    },
    docs: {
      terminal_status: "delivered",
      columns: { outline: "Planning", drafting: "Review", delivered: "Done" },
      phases: [],
    },
  },
  gate_labels: {},
  artifact_labels: {},
};

function kindedTask(id: string, status: string, kind: Kind | null): Task {
  return { ...makeTask(id, status), kind };
}

describe("columnFor", () => {
  it("maps code phases to universal columns via templates", () => {
    expect(columnFor(kindedTask("c", "building", "code"), TEMPLATES)).toBe("In progress");
    expect(columnFor(kindedTask("c", "pr_review", "code"), TEMPLATES)).toBe("Review");
    expect(columnFor(kindedTask("c", "shipped", "code"), TEMPLATES)).toBe("Done");
  });

  it("maps research + docs phases to universal columns", () => {
    expect(columnFor(kindedTask("r", "investigating", "research"), TEMPLATES)).toBe("In progress");
    expect(columnFor(kindedTask("r", "synthesis", "research"), TEMPLATES)).toBe("Review");
    expect(columnFor(kindedTask("d", "drafting", "docs"), TEMPLATES)).toBe("Review");
    expect(columnFor(kindedTask("d", "delivered", "docs"), TEMPLATES)).toBe("Done");
  });

  it("puts untyped (kind null) and ready tasks in Ready", () => {
    expect(columnFor(kindedTask("u", "ready", null), TEMPLATES)).toBe("Ready");
    // a null-kind task with a non-ready status still lands in Ready
    expect(columnFor(kindedTask("u", "building", null), TEMPLATES)).toBe("Ready");
    expect(columnFor(kindedTask("r", "ready", "research"), TEMPLATES)).toBe("Ready");
  });

  it("excludes blocked tasks from any column (banner instead)", () => {
    expect(columnFor(kindedTask("b", "blocked", "code"), TEMPLATES)).toBeNull();
  });

  it("falls back to Ready when templates are absent or the phase is unknown", () => {
    expect(columnFor(kindedTask("c", "building", "code"))).toBe("Ready");
    expect(columnFor(kindedTask("c", "mystery", "code"), TEMPLATES)).toBe("Ready");
  });
});

describe("tasksByColumn", () => {
  it("buckets tasks into all 5 columns, excluding blocked", () => {
    const tasks = [
      kindedTask("a", "ready", null),
      kindedTask("b", "building", "code"),
      kindedTask("c", "investigating", "research"),
      kindedTask("d", "shipped", "code"),
      kindedTask("e", "blocked", "code"),
    ];
    const buckets = tasksByColumn(tasks, TEMPLATES);
    for (const c of BOARD_COLUMNS) expect(buckets).toHaveProperty(c);
    expect(buckets.Ready.map((t) => t.id)).toEqual(["a"]);
    expect(buckets["In progress"].map((t) => t.id)).toEqual(["b", "c"]);
    expect(buckets.Done.map((t) => t.id)).toEqual(["d"]);
    // blocked excluded from every column
    expect(Object.values(buckets).flat().map((t) => t.id)).not.toContain("e");
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
