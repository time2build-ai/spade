import { describe, expect, it } from "vitest";
import {
  filterRuns,
  pipelineKpis,
  runActiveSession,
  runStepLabel,
  stageVisual,
} from "@/lib/adapters";
import type { PipelineRun, PipelineStage, StageState } from "@/lib/types";
import { STAGE_ROLES } from "@/lib/types";

function stage(state: StageState, i: number, over: Partial<PipelineStage> = {}): PipelineStage {
  return {
    id: `st-${i}`,
    pipeline_run_id: "run-1",
    role: STAGE_ROLES[i] ?? "developer",
    stage_order: i,
    state,
    session_id: null,
    account_id: null,
    created_at: "2026-06-22T00:00:00Z",
    ...over,
  };
}

function run(
  status: PipelineRun["status"],
  states: StageState[],
  over: Partial<PipelineRun> = {},
): PipelineRun {
  return {
    id: "run-1",
    project_id: "p-1",
    task_id: "t-1",
    status,
    current_stage: 0,
    created_at: "2026-06-22T00:00:00Z",
    stages: states.map((s, i) => stage(s, i)),
    ...over,
  };
}

describe("stageVisual", () => {
  it("maps done -> green", () => {
    expect(stageVisual("done")).toEqual({ key: "done", color: "var(--green)" });
  });
  it("maps running -> blue", () => {
    expect(stageVisual("running")).toEqual({ key: "run", color: "var(--blue)" });
  });
  it("maps queued -> muted", () => {
    expect(stageVisual("queued")).toEqual({ key: "queue", color: "var(--text-3)" });
  });
  it("maps failed -> amber gate", () => {
    expect(stageVisual("failed")).toEqual({ key: "gate", color: "var(--amber)" });
  });
});

describe("runStepLabel", () => {
  it("returns 'shipped' for a shipped run", () => {
    expect(runStepLabel(run("shipped", ["done", "done", "done", "done"]))).toBe("shipped");
  });
  it("returns 'paused' for a paused run", () => {
    expect(runStepLabel(run("paused", ["done", "failed", "queued", "queued"]))).toBe("paused");
  });
  it("uses the running stage index (1-based) when one is running", () => {
    expect(runStepLabel(run("running", ["done", "running", "queued", "queued"]))).toBe("step 2/4");
  });
  it("falls back to done count when none running", () => {
    expect(runStepLabel(run("queued", ["done", "done", "queued", "queued"]))).toBe("step 2/4");
  });
  it("is step 0/4 for a fresh queued run", () => {
    expect(runStepLabel(run("queued", ["queued", "queued", "queued", "queued"]))).toBe("step 0/4");
  });
});

describe("runActiveSession", () => {
  it("returns the session_id of the running stage", () => {
    const r = run("running", ["done", "running", "queued", "queued"]);
    r.stages[1].session_id = "sess-abc";
    expect(runActiveSession(r)).toBe("sess-abc");
  });
  it("returns null when no stage is running", () => {
    expect(runActiveSession(run("shipped", ["done", "done", "done", "done"]))).toBeNull();
  });
  it("returns null when the running stage has no session", () => {
    expect(runActiveSession(run("running", ["done", "running", "queued", "queued"]))).toBeNull();
  });
});

describe("pipelineKpis", () => {
  it("counts active/gated/shipped/queued from a mixed list", () => {
    const runs = [
      run("running", ["done", "running", "queued", "queued"]),
      run("paused", ["done", "failed", "queued", "queued"]),
      run("running", ["failed", "queued", "queued", "queued"]), // running but has failed stage -> gated
      run("shipped", ["done", "done", "done", "done"]),
      run("queued", ["queued", "queued", "queued", "queued"]),
    ];
    expect(pipelineKpis(runs)).toEqual({ active: 2, gated: 2, shipped: 1, queued: 1 });
  });
  it("is all zeros for an empty list", () => {
    expect(pipelineKpis([])).toEqual({ active: 0, gated: 0, shipped: 0, queued: 0 });
  });
});

describe("filterRuns", () => {
  const runs = [
    run("running", ["done", "running", "queued", "queued"]),
    run("paused", ["done", "failed", "queued", "queued"]),
    run("shipped", ["done", "done", "done", "done"]),
    run("queued", ["queued", "queued", "queued", "queued"]),
  ];
  it("'all' returns everything", () => {
    expect(filterRuns(runs, "all")).toHaveLength(4);
  });
  it("'active' excludes shipped and paused", () => {
    expect(filterRuns(runs, "active").map((r) => r.status)).toEqual(["running", "queued"]);
  });
  it("'paused' returns only paused", () => {
    expect(filterRuns(runs, "paused").map((r) => r.status)).toEqual(["paused"]);
  });
  it("'shipped' returns only shipped", () => {
    expect(filterRuns(runs, "shipped").map((r) => r.status)).toEqual(["shipped"]);
  });
});
