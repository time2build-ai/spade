import { pipelineKpis } from "@/lib/adapters";
import type { PipelineRun } from "@/lib/types";

type Cell = { lbl: string; val: number | string; sub?: string; subMono?: boolean; color?: string };

/** KPI strip — every cell is a real count derived from the pipeline runs. No
 *  fabricated tokens / cost / throughput / concurrency (the pipeline model
 *  doesn't track those). */
export function KpiStrip({ runs }: { runs: PipelineRun[] }) {
  const k = pipelineKpis(runs);
  const cells: Cell[] = [
    { lbl: "Active", val: k.active, sub: `${k.active + k.queued} in flight` },
    { lbl: "Queued", val: k.queued, sub: k.queued > 0 ? "waiting to start" : "—" },
    { lbl: "Shipped", val: k.shipped, sub: `of ${runs.length} runs`, color: k.shipped ? "var(--green)" : undefined },
    { lbl: "Awaiting human", val: k.gated, sub: k.gated > 0 ? "needs review" : "none pending", color: k.gated ? "var(--amber)" : undefined },
  ];
  return (
    <div className="orch-summary-strip">
      {cells.map((c) => (
        <div className="stat-cell" key={c.lbl}>
          <div className="lbl">{c.lbl}</div>
          <div className="val" style={c.color ? { color: c.color } : undefined}>{c.val}</div>
          {c.sub && <div className={"sub" + (c.subMono ? " mono" : "")}>{c.sub}</div>}
        </div>
      ))}
    </div>
  );
}
