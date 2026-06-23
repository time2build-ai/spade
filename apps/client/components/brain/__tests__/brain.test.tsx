import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { BrainLegend } from "../BrainLegend";
import { NodeInfo } from "../NodeInfo";
import { GraphCanvas } from "../GraphCanvas";
import type { BrainEdge, BrainNode, BrainNodeType } from "@/lib/types";

const ALL: BrainNodeType[] = [
  "feature",
  "decision",
  "convention",
  "feedback",
  "bug",
  "metric",
];

function node(
  id: string,
  type: BrainNodeType,
  over: Partial<BrainNode> = {},
): BrainNode {
  return {
    id,
    project_id: "p1",
    type,
    label: `${id}-label`,
    detail: null,
    x: null,
    y: null,
    ...over,
  };
}

describe("BrainLegend", () => {
  const nodes = [
    node("a", "feature"),
    node("b", "feature"),
    node("c", "bug"),
  ];

  test("renders the 6 types with counts", () => {
    render(
      <BrainLegend
        nodes={nodes}
        visibleTypes={new Set(ALL)}
        onToggle={() => {}}
      />,
    );
    expect(screen.getByText("Features")).toBeInTheDocument();
    expect(screen.getByText("Decisions")).toBeInTheDocument();
    expect(screen.getByText("Conventions")).toBeInTheDocument();
    expect(screen.getByText("Feedback")).toBeInTheDocument();
    expect(screen.getByText("Bugs")).toBeInTheDocument();
    expect(screen.getByText("Metrics")).toBeInTheDocument();
    // feature count = 2
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  test("toggling a type calls the handler with that type", () => {
    const onToggle = vi.fn();
    render(
      <BrainLegend
        nodes={nodes}
        visibleTypes={new Set(ALL)}
        onToggle={onToggle}
      />,
    );
    fireEvent.click(screen.getByText("Bugs"));
    expect(onToggle).toHaveBeenCalledWith("bug");
  });
});

describe("NodeInfo", () => {
  test("with a selected node renders its label + type chip", () => {
    const sel = node("a", "feature", { detail: "some detail" });
    const { container } = render(
      <NodeInfo node={sel} nodes={[sel]} edges={[]} />,
    );
    expect(screen.getByText("a-label")).toBeInTheDocument();
    expect(container.querySelector(".chip.feature")).toBeInTheDocument();
  });

  test("with no selection renders the empty state", () => {
    render(<NodeInfo node={null} nodes={[]} edges={[]} />);
    expect(screen.getByText("Select a node")).toBeInTheDocument();
  });
});

describe("GraphCanvas", () => {
  const nodes = [
    node("a", "feature", { x: 0.2, y: 0.3 }),
    node("b", "bug", { x: 0.8, y: 0.6 }),
  ];
  const edges: BrainEdge[] = [
    { id: "e1", project_id: "p1", from_id: "a", to_id: "b", rel: "relates_to" },
  ];

  test("renders an svg with one circle per node", () => {
    const { container } = render(
      <GraphCanvas
        nodes={nodes}
        edges={edges}
        selectedId={null}
        onSelect={() => {}}
      />,
    );
    expect(container.querySelector("svg")).toBeInTheDocument();
    // one node group per node
    expect(container.querySelectorAll("[data-node-id]").length).toBe(2);
  });

  test("clicking a node calls onSelect with its id", () => {
    const onSelect = vi.fn();
    const { container } = render(
      <GraphCanvas
        nodes={nodes}
        edges={edges}
        selectedId={null}
        onSelect={onSelect}
      />,
    );
    const groupA = container.querySelector('[data-node-id="a"]')!;
    fireEvent.click(groupA);
    expect(onSelect).toHaveBeenCalledWith("a");
  });
});
