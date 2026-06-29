import { describe, expect, it } from "vitest";
import { recommendedFirstTask, taskExecutionStates, taskRelations } from "@/lib/adapters";
import type { LinkRel, Status, Task, TaskLink } from "@/lib/types";

let seq = 0;
function link(from: string, to: string, rel: LinkRel): TaskLink {
  return {
    id: `l${seq++}`,
    from_task: from,
    to_task: to,
    rel,
    created_at: "2026-01-01",
  };
}

function task(id: string, status: Status, links: TaskLink[] = [], priority = 1): Task {
  return {
    id, project_id: "p1", title: id, feature: null, priority, status,
    origin_quote: null, origin_source: null, description: null, created_at: "2026-01-01",
    nodes: [], links,
  };
}

describe("taskRelations", () => {
  it("returns all-empty buckets when there are no links", () => {
    expect(taskRelations("SPD-1", [])).toEqual({
      blockedBy: [],
      blocks: [],
      related: [],
      parent: [],
      subtasks: [],
    });
  });

  it("blocks is directional: from==T && blocks => blocks bucket (the to side)", () => {
    const links = [link("SPD-1", "SPD-2", "blocks")];
    const r = taskRelations("SPD-1", links);
    expect(r.blocks).toEqual(["SPD-2"]);
    expect(r.blockedBy).toEqual([]);
  });

  it("blockedBy: to==T && blocks => blockedBy bucket (the from side)", () => {
    const links = [link("SPD-1", "SPD-2", "blocks")];
    const r = taskRelations("SPD-2", links);
    expect(r.blockedBy).toEqual(["SPD-1"]);
    expect(r.blocks).toEqual([]);
  });

  it("subtask: from==T => subtasks (children); to==T => parent", () => {
    const links = [link("EPIC", "CHILD", "subtask")];
    expect(taskRelations("EPIC", links).subtasks).toEqual(["CHILD"]);
    expect(taskRelations("EPIC", links).parent).toEqual([]);
    expect(taskRelations("CHILD", links).parent).toEqual(["EPIC"]);
    expect(taskRelations("CHILD", links).subtasks).toEqual([]);
  });

  it("related is symmetric: returns the OTHER end regardless of direction", () => {
    const links = [link("SPD-1", "SPD-2", "related"), link("SPD-3", "SPD-1", "related")];
    expect(taskRelations("SPD-1", links).related.sort()).toEqual(["SPD-2", "SPD-3"]);
    expect(taskRelations("SPD-2", links).related).toEqual(["SPD-1"]);
  });

  it("buckets a mixed set correctly for one task", () => {
    const links = [
      link("UP", "T", "blocks"), // T is blocked by UP
      link("T", "DOWN", "blocks"), // T blocks DOWN
      link("P", "T", "subtask"), // P is parent of T
      link("T", "C", "subtask"), // T is parent of C
      link("T", "R", "related"),
    ];
    expect(taskRelations("T", links)).toEqual({
      blockedBy: ["UP"],
      blocks: ["DOWN"],
      related: ["R"],
      parent: ["P"],
      subtasks: ["C"],
    });
  });
});

describe("taskExecutionStates / recommendedFirstTask", () => {
  // SPD-1 blocks SPD-2 (so 2 is blocked by 1). EPIC has SPD-1 as a subtask.
  const links = [link("SPD-1", "SPD-2", "blocks"), link("EPIC", "SPD-1", "subtask")];
  const mk = (s1: Status, s2: Status) => [
    task("EPIC", "ready", links, 0),
    task("SPD-1", s1, links, 1),
    task("SPD-2", s2, links, 1),
  ];

  it("a ready leaf with no open blocker is startable; the one it blocks is not", () => {
    const st = taskExecutionStates(mk("ready", "ready"));
    expect(st.get("SPD-1")!.startable).toBe(true);
    expect(st.get("SPD-2")!).toMatchObject({ startable: false, blockedByOpen: 1 });
    expect(st.get("EPIC")!).toMatchObject({ startable: false, isEpic: true });
  });

  it("the blocked task becomes startable once its blocker ships", () => {
    const st = taskExecutionStates(mk("shipped", "ready"));
    expect(st.get("SPD-2")!).toMatchObject({ startable: true, blockedByOpen: 0 });
  });

  it("recommendedFirstTask picks the startable leaf (never the epic) by priority", () => {
    expect(recommendedFirstTask(mk("ready", "ready"))!.id).toBe("SPD-1");
    // once SPD-1 ships, the next executable is SPD-2
    expect(recommendedFirstTask(mk("shipped", "ready"))!.id).toBe("SPD-2");
    // nothing startable → null
    expect(recommendedFirstTask(mk("shipped", "shipped"))).toBeNull();
  });
});
