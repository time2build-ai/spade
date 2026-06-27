import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { DecisionCard, adrCode } from "../DecisionCard";
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
  test("renders the ADR code, label and a detail preview", () => {
    render(<DecisionCard node={decision()} index={6} onOpen={() => {}} />);
    expect(screen.getByText(adrCode(6))).toBeInTheDocument(); // ADR-007
    expect(
      screen.getByText("Use SQLite for local persistence"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Single-file DB under TUI_PILOT_HOME."),
    ).toBeInTheDocument();
  });

  test("clicking the row opens the decision", () => {
    const onOpen = vi.fn();
    render(<DecisionCard node={decision()} index={0} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onOpen).toHaveBeenCalledWith(decision());
  });

  test("omits the preview when detail is null without crashing", () => {
    const { container } = render(
      <DecisionCard node={decision({ detail: null })} index={0} onOpen={() => {}} />,
    );
    expect(
      screen.getByText("Use SQLite for local persistence"),
    ).toBeInTheDocument();
    expect(container.querySelector(".dec-row-snippet")).toBeNull();
  });
});
