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

  test("resolves 2 node types into 2 chips + 2 intel segments", () => {
    const nodesById = {
      n1: node("n1", "feedback"),
      n2: node("n2", "bug"),
    };
    const task = makeTask({ nodes: ["n1", "n2"] });
    const { container } = render(
      <TaskCard task={task} nodesById={nodesById} />,
    );

    expect(container.querySelectorAll("[data-chip-type]")).toHaveLength(2);
    expect(container.querySelectorAll("[data-intel-type]")).toHaveLength(2);
    expect(
      container.querySelector('[data-chip-type="feedback"]'),
    ).toBeInTheDocument();
    expect(
      container.querySelector('[data-chip-type="bug"]'),
    ).toBeInTheDocument();
  });

  test("shows faint empty intel bar and no chips when no nodes", () => {
    const { container } = render(<TaskCard task={makeTask()} nodesById={{}} />);
    expect(container.querySelectorAll("[data-chip-type]")).toHaveLength(0);
    expect(container.querySelectorAll("[data-intel-type]")).toHaveLength(0);
    expect(container.querySelector(".intel-bar")).toBeInTheDocument();
  });

  test("footer shows unassigned (no agent endpoint M1)", () => {
    render(<TaskCard task={makeTask()} nodesById={{}} />);
    expect(screen.getByText("unassigned")).toBeInTheDocument();
  });
});

describe("Board", () => {
  test("renders all 5 columns with correct counts", () => {
    const tasks = [
      makeTask({ id: "SPD-1", status: "ready" }),
      makeTask({ id: "SPD-2", status: "ready" }),
      makeTask({ id: "SPD-3", status: "review" }),
    ];
    const { container } = render(<Board tasks={tasks} nodesById={{}} />);

    const cols = container.querySelectorAll(".col");
    expect(cols).toHaveLength(5);

    const ready = container.querySelector('[data-status="ready"] .count');
    expect(ready).toHaveTextContent("2");
    const review = container.querySelector('[data-status="review"] .count');
    expect(review).toHaveTextContent("1");
    const shipped = container.querySelector('[data-status="shipped"] .count');
    expect(shipped).toHaveTextContent("0");
  });
});
