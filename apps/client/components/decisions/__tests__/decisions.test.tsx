import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { DecisionCard } from "../DecisionCard";
import type { BrainNode } from "@/lib/types";

function decision(over: Partial<BrainNode> = {}): BrainNode {
  return {
    id: "n1",
    project_id: "p1",
    type: "decision",
    label: "Use SQLite for local persistence",
    detail: "Single-file DB under TUI_PILOT_HOME.",
    x: null,
    y: null,
    ...over,
  };
}

describe("DecisionCard", () => {
  test("renders label, detail, and a decision chip", () => {
    const { container } = render(<DecisionCard node={decision()} />);
    expect(
      screen.getByText("Use SQLite for local persistence"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Single-file DB under TUI_PILOT_HOME."),
    ).toBeInTheDocument();
    const chip = container.querySelector(".chip.decision");
    expect(chip).toBeInTheDocument();
    expect(chip).toHaveTextContent("ADR");
  });

  test("omits the body when detail is null without crashing", () => {
    const { container } = render(
      <DecisionCard node={decision({ detail: null })} />,
    );
    expect(
      screen.getByText("Use SQLite for local persistence"),
    ).toBeInTheDocument();
    expect(container.querySelector(".decision-card-detail")).toBeNull();
  });
});
