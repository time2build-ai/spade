import { pipelineKpis } from "@/lib/adapters";
import { DEMO_ORCH_KPIS } from "@/lib/demo";
import type { PipelineRun } from "@/lib/types";

type Cell = { lbl: string; val: number | string; sub?: string; subMono?: boolean; color?: string };

/** 6-cell KPI strip with sub-lines (reference). Active/Shipped/Awaiting-human
 *  use real counts; Tokens/Throughput/Concurrency are seeded. */
export function KpiStrip({ runs }: { runs: PipelineRun[] }) {
  const k = pipelineKpis(runs);
  const cells: Cell[] = [
    { lbl: "Active", val: k.active, sub: `${k.active + k.queued} sessions` },
    { lbl: "Shipped today", val: k.shipped, sub: "since 06:00", color: "var(--green)" },
    { lbl: "Awaiting human", val: k.gated, sub: k.gated > 0 ? "needs review" : "—", color: "var(--amber)" },
    ...DEMO_ORCH_KPIS,
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
