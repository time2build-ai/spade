import { describe, expect, it } from "vitest";
import { taskRelations } from "@/lib/adapters";
import type { LinkRel, TaskLink } from "@/lib/types";

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
