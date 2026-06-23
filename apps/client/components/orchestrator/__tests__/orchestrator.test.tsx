import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { StagesMini } from "../StagesMini";
import { PipelineCard } from "../PipelineCard";
import { KpiStrip } from "../KpiStrip";
import { Terminal } from "../Terminal";
import type { PipelineRun, PipelineStage, StageState } from "@/lib/types";

function stage(over: Partial<PipelineStage> = {}): PipelineStage {
  return {
    id: over.id ?? `st-${over.stage_order ?? 0}`,
    pipeline_run_id: "run1",
    role: "developer",
    stage_order: 0,
    state: "queued",
    session_id: null,
    account_id: null,
    created_at: "2026-01-01",
    ...over,
  };
}

function run(over: Partial<PipelineRun> = {}): PipelineRun {
  const states: StageState[] = ["done", "running", "queued", "queued"];
  const roles = ["developer", "reviewer", "integrator", "documentor"];
  return {
    id: "run1",
    project_id: "p1",
    task_id: "SPD-001",
    status: "running",
    current_stage: 1,
    created_at: "2026-01-01",
    stages: roles.map((role, i) =>
      stage({ id: `st-${i}`, role, stage_order: i, state: states[i] }),
    ),
    ...over,
  };
}

describe("StagesMini", () => {
  test("renders 4 segments with state classes for mixed states", () => {
    const stages = [
      stage({ id: "a", state: "done" }),
      stage({ id: "b", state: "running" }),
      stage({ id: "c", state: "queued" }),
      stage({ id: "d", state: "failed" }),
    ];
    render(<StagesMini stages={stages} />);
    const segs = screen.getAllByTestId("stage-seg");
    expect(segs).toHaveLength(4);
    expect(segs[0].className).toBe("done");
    expect(segs[1].className).toBe("run");
    expect(segs[2].className).toBe("queue");
    expect(segs[3].className).toBe("gate");
  });
});

describe("PipelineCard", () => {
  test("renders task id and step label", () => {
    render(
      <PipelineCard run={run()} onStart={vi.fn()} onAdvance={vi.fn()} />,
    );
    expect(screen.getByText("SPD-001")).toBeTruthy();
    expect(screen.getByText("step 2/4")).toBeTruthy();
  });

  test("shows Advance when running and calls onAdvance", async () => {
    const onAdvance = vi.fn().mockResolvedValue(undefined);
    render(
      <PipelineCard run={run()} onStart={vi.fn()} onAdvance={onAdvance} />,
    );
    fireEvent.click(screen.getByText("SPD-001"));
    await act(async () => {
      fireEvent.click(screen.getByText("Advance"));
    });
    expect(onAdvance).toHaveBeenCalledWith("run1");
  });

  test("shows Start when queued and calls onStart", async () => {
    const onStart = vi.fn().mockResolvedValue(undefined);
    render(
      <PipelineCard
        run={run({ status: "queued" })}
        onStart={onStart}
        onAdvance={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText("SPD-001"));
    await act(async () => {
      fireEvent.click(screen.getByText("Start"));
    });
    expect(onStart).toHaveBeenCalledWith("run1");
  });

  test("expands to per-stage detail on click", () => {
    render(
      <PipelineCard run={run()} onStart={vi.fn()} onAdvance={vi.fn()} />,
    );
    expect(screen.queryByText("Reviewer")).toBeNull();
    fireEvent.click(screen.getByText("SPD-001"));
    expect(screen.getByText("Developer")).toBeTruthy();
    expect(screen.getByText("Reviewer")).toBeTruthy();
    expect(screen.getByText("Running")).toBeTruthy();
  });
});

describe("KpiStrip", () => {
  test("renders the 4 KPI numbers from a mixed run list", () => {
    const runs = [
      run({ id: "r1", status: "running" }),
      run({ id: "r2", status: "shipped" }),
      run({ id: "r3", status: "queued" }),
      run({ id: "r4", status: "paused" }),
    ];
    const { container } = render(<KpiStrip runs={runs} />);
    const cells = container.querySelectorAll(".stat-cell");
    expect(cells).toHaveLength(4);
    // Active=1, Gated=1 (paused), Shipped=1, Queued=1
    cells.forEach((cell) => {
      expect(within(cell as HTMLElement).getByText("1")).toBeTruthy();
    });
  });
});

describe("Terminal", () => {
  test("sessionId null renders empty state", () => {
    render(<Terminal sessionId={null} />);
    expect(screen.getByText("no live session")).toBeTruthy();
  });
});
