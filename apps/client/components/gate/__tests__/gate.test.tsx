import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { GateCard, formatBrakeType } from "../GateCard";
import type { Brake } from "@/lib/types";

function brake(over: Partial<Brake> = {}): Brake {
  return {
    id: "brk_1",
    mission: "mission_42",
    brake: "opus_spawn",
    detail: "Wants to spawn an Opus worker above the model ceiling.",
    worker: "wrk_7",
    ...over,
  };
}

describe("formatBrakeType", () => {
  test("turns opus_spawn into 'Opus spawn'", () => {
    expect(formatBrakeType("opus_spawn")).toBe("Opus spawn");
  });
});

describe("GateCard", () => {
  test("renders the brake detail, type, and mission", () => {
    render(
      <GateCard brake={brake()} onAllow={vi.fn()} onSkip={vi.fn()} />,
    );
    expect(
      screen.getByText("Wants to spawn an Opus worker above the model ceiling."),
    ).toBeInTheDocument();
    expect(screen.getByText("Opus spawn")).toBeInTheDocument();
    expect(screen.getByText("mission_42")).toBeInTheDocument();
  });

  test("clicking Allow calls onAllow(id)", async () => {
    const onAllow = vi.fn().mockResolvedValue(undefined);
    render(
      <GateCard brake={brake()} onAllow={onAllow} onSkip={vi.fn()} />,
    );
    await act(async () => {
      fireEvent.click(screen.getByText("Allow"));
    });
    expect(onAllow).toHaveBeenCalledWith("brk_1");
  });

  test("clicking Skip calls onSkip(id)", async () => {
    const onSkip = vi.fn().mockResolvedValue(undefined);
    render(
      <GateCard brake={brake()} onAllow={vi.fn()} onSkip={onSkip} />,
    );
    await act(async () => {
      fireEvent.click(screen.getByText("Skip"));
    });
    expect(onSkip).toHaveBeenCalledWith("brk_1");
  });
});
