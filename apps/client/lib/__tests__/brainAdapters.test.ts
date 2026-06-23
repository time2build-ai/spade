import { describe, expect, it } from "vitest";
import { layoutNodes, nodeColor, nodeTypeCounts } from "@/lib/adapters";
import type { BrainNode, BrainNodeType } from "@/lib/types";

const NODE_TYPES: BrainNodeType[] = [
  "feature",
  "decision",
  "convention",
  "feedback",
  "bug",
  "metric",
];

function makeNode(
  id: string,
  type: BrainNodeType,
  x: number | null = null,
  y: number | null = null,
): BrainNode {
  return { id, project_id: "p1", type, label: id, detail: null, x, y };
}

describe("nodeTypeCounts", () => {
  it("returns all 6 type keys with zero for missing types", () => {
    const counts = nodeTypeCounts([]);
    expect(Object.keys(counts).sort()).toEqual([...NODE_TYPES].sort());
    for (const t of NODE_TYPES) expect(counts[t]).toBe(0);
  });

  it("counts nodes per type", () => {
    const counts = nodeTypeCounts([
      makeNode("a", "feature"),
      makeNode("b", "feature"),
      makeNode("c", "bug"),
    ]);
    expect(counts.feature).toBe(2);
    expect(counts.bug).toBe(1);
    expect(counts.metric).toBe(0);
  });
});

describe("nodeColor", () => {
  it("maps each type to its token var", () => {
    expect(nodeColor("feature")).toBe("var(--accent)");
    expect(nodeColor("decision")).toBe("var(--amber)");
    expect(nodeColor("feedback")).toBe("var(--blue)");
    expect(nodeColor("bug")).toBe("var(--red)");
    expect(nodeColor("metric")).toBe("var(--teal)");
    expect(nodeColor("convention")).toBe("var(--pink)");
  });
});

describe("layoutNodes", () => {
  const W = 800;
  const H = 600;
  const PAD = 40;

  it("maps nodes with coords inside the padded bounds", () => {
    const nodes = [
      makeNode("a", "feature", 0.1, 0.2),
      makeNode("b", "bug", 0.9, 0.8),
      makeNode("c", "metric", 0.5, 0.5),
    ];
    const out = layoutNodes(nodes, W, H, PAD);
    for (const n of out) {
      expect(n.px).toBeGreaterThanOrEqual(PAD);
      expect(n.px).toBeLessThanOrEqual(W - PAD);
      expect(n.py).toBeGreaterThanOrEqual(PAD);
      expect(n.py).toBeLessThanOrEqual(H - PAD);
    }
  });

  it("gives finite positions to null-coord nodes", () => {
    const nodes = [
      makeNode("a", "feature", null, null),
      makeNode("b", "bug", null, null),
      makeNode("c", "metric", null, null),
    ];
    const out = layoutNodes(nodes, W, H, PAD);
    for (const n of out) {
      expect(Number.isFinite(n.px)).toBe(true);
      expect(Number.isFinite(n.py)).toBe(true);
      expect(n.px).toBeGreaterThanOrEqual(0);
      expect(n.px).toBeLessThanOrEqual(W);
      expect(n.py).toBeGreaterThanOrEqual(0);
      expect(n.py).toBeLessThanOrEqual(H);
    }
  });

  it("is deterministic for the same input", () => {
    const nodes = [
      makeNode("a", "feature", 0.3, 0.4),
      makeNode("b", "bug", null, null),
    ];
    const a = layoutNodes(nodes, W, H, PAD);
    const b = layoutNodes(nodes, W, H, PAD);
    expect(a).toEqual(b);
  });

  it("preserves original node fields", () => {
    const nodes = [makeNode("a", "feature", 0.3, 0.4)];
    const out = layoutNodes(nodes, W, H, PAD);
    expect(out[0].id).toBe("a");
    expect(out[0].type).toBe("feature");
  });
});
