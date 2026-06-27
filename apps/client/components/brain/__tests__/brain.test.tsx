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
    expect(screen.getByText("Nothing selected")).toBeInTheDocument();
    expect(
      screen.getByText(/Click a node in the graph/i),
    ).toBeInTheDocument();
  });

  test("a decision node links to its record on the Decisions page", () => {
    const sel = node("d1", "decision");
    render(<NodeInfo node={sel} nodes={[sel]} edges={[]} />);
    const link = screen.getByRole("link", { name: /View in Decisions/i });
    expect(link).toHaveAttribute("href", "/decisions#dec-d1");
  });

  test("links to the tasks a node is grounded in", () => {
    const sel = node("n1", "feature");
    const task = {
      id: "SPD-002",
      project_id: "p1",
      title: "Wire up OAuth",
      feature: null,
      priority: 0,
      status: "ready",
      origin_quote: null,
      origin_source: null,
      description: null,
      created_at: "2026-06-01",
      nodes: ["n1"],
      links: [],
    } as unknown as import("@/lib/types").Task;
    render(<NodeInfo node={sel} nodes={[sel]} edges={[]} tasks={[task]} />);
    const link = screen.getByRole("link", { name: /SPD-002.*Wire up OAuth/i });
    expect(link).toHaveAttribute("href", "/task/SPD-002");
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

  test("selecting a node dims unconnected nodes (focus highlighting)", () => {
    // a—b are linked; c is unconnected. Selecting a should keep a & b lit and
    // dim c.
    const focusNodes = [...nodes, node("c", "metric", { x: 0.5, y: 0.9 })];
    const { container } = render(
      <GraphCanvas
        nodes={focusNodes}
        edges={edges}
        selectedId="a"
        onSelect={() => {}}
      />,
    );
    const g = (id: string) =>
      container.querySelector(`[data-node-id="${id}"]`) as HTMLElement;
    expect(g("a").style.opacity).toBe("1");
    expect(g("b").style.opacity).toBe("1");
    expect(g("c").style.opacity).toBe("0.22");
  });
});
