import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { TaskCard } from "../TaskCard";
import { Board } from "../Board";
import type { BrainNode, Task } from "@/lib/types";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

function makeTask(over: Partial<Task> = {}): Task {
  return {
    id: "SPD-101",
    project_id: "p1",
    title: "Wire up OAuth login",
    feature: "Auth",
    priority: 0,
    status: "in_progress",
    origin_quote: null,
    origin_source: null,
    description: null,
    created_at: "2026-01-01",
    nodes: [],
    links: [],
    ...over,
  };
}

function node(id: string, type: BrainNode["type"]): BrainNode {
  return {
    id,
    project_id: "p1",
    type,
    label: id,
    detail: null,
    x: null,
    y: null,
  };
}

describe("TaskCard", () => {
  test("renders task id, title, priority marker, and links to detail", () => {
    const { container } = render(<TaskCard task={makeTask()} nodesById={{}} />);

    expect(screen.getByText("SPD-101")).toBeInTheDocument();
    expect(screen.getByText("Wire up OAuth login")).toBeInTheDocument();
    expect(container.querySelector(".priority")).toBeInTheDocument();

    const link = container.querySelector("a.task-card");
    expect(link).toHaveAttribute("href", "/task/SPD-101");
  });

  test("renders feature when present", () => {
    render(<TaskCard task={makeTask({ feature: "Billing" })} nodesById={{}} />);
    expect(screen.getByText("Billing")).toBeInTheDocument();
  });

  test("resolves linked node types into chips + intel segments (reference wording)", () => {
    const nodesById = {
      n1: node("n1", "feedback"),
      n2: node("n2", "bug"),
    };
    const task = makeTask({ nodes: ["n1", "n2"] });
    const { container } = render(<TaskCard task={task} nodesById={nodesById} />);

    expect(container.querySelector(".chip.feedback")).toHaveTextContent("1 feedback");
    expect(container.querySelector(".chip.bug")).toHaveTextContent("1 bug");
    expect(container.querySelector('[data-intel-type="feedback"]')).toBeInTheDocument();
    expect(container.querySelector('[data-intel-type="bug"]')).toBeInTheDocument();
  });

  test("a decision node renders an 'ADR' chip (reference wording)", () => {
    const nodesById = { d1: node("d1", "decision") };
    const { container } = render(<TaskCard task={makeTask({ nodes: ["d1"] })} nodesById={nodesById} />);
    expect(container.querySelector(".chip.decision")).toHaveTextContent("1 ADR");
  });

  test("no node-derived chips when there are no linked nodes", () => {
    const { container } = render(<TaskCard task={makeTask()} nodesById={{}} />);
    // meetings is seeded, but feedback/bug/decision/metric come from real nodes.
    expect(container.querySelector(".chip.feedback")).toBeNull();
    expect(container.querySelector(".chip.bug")).toBeNull();
    expect(container.querySelector(".chip.decision")).toBeNull();
    expect(container.querySelector(".chip.metric")).toBeNull();
  });

  test("footer shows the real status (no fabricated assignee)", () => {
    const { container, getByText } = render(<TaskCard task={makeTask({ status: "ready" })} nodesById={{}} />);
    // No seeded assignee avatar anymore — the foot reflects real task state.
    expect(container.querySelector(".tc-foot .avatar")).not.toBeInTheDocument();
    expect(getByText("ready")).toBeInTheDocument();
  });

  test("an in-progress task shows the 'building' pill", () => {
    const { getByText } = render(<TaskCard task={makeTask({ status: "in_progress" })} nodesById={{}} />);
    expect(getByText("building")).toBeInTheDocument();
  });
});

describe("Board", () => {
  test("renders 4 columns with correct counts (blocked is not a column)", () => {
    const tasks = [
      makeTask({ id: "SPD-1", status: "ready" }),
      makeTask({ id: "SPD-2", status: "ready" }),
      makeTask({ id: "SPD-3", status: "review" }),
      makeTask({ id: "SPD-4", status: "blocked" }),
    ];
    const { container } = render(<Board tasks={tasks} nodesById={{}} />);

    const cols = container.querySelectorAll(".col");
    expect(cols).toHaveLength(4);
    // Blocked is surfaced in the banner (page-level), never as a board column.
    expect(container.querySelector('[data-status="blocked"]')).toBeNull();

    const ready = container.querySelector('[data-status="ready"] .count');
    expect(ready).toHaveTextContent("2");
    const review = container.querySelector('[data-status="review"] .count');
    expect(review).toHaveTextContent("1");
    const shipped = container.querySelector('[data-status="shipped"] .count');
    expect(shipped).toHaveTextContent("0");
  });
});
