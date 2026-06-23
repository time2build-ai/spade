import { pipelineKpis } from "@/lib/adapters";
import type { PipelineRun } from "@/lib/types";

/** The 4 stat cells: Active / Gated / Shipped / Queued. */
export function KpiStrip({ runs }: { runs: PipelineRun[] }) {
  const kpis = pipelineKpis(runs);
  const cells: { lbl: string; val: number; color?: string }[] = [
    { lbl: "Active", val: kpis.active },
    { lbl: "Gated", val: kpis.gated, color: "var(--amber)" },
    { lbl: "Shipped", val: kpis.shipped, color: "var(--green)" },
    { lbl: "Queued", val: kpis.queued },
  ];
  return (
    <div className="orch-summary-strip">
      {cells.map((c) => (
        <div className="stat-cell" key={c.lbl}>
          <div className="lbl">{c.lbl}</div>
          <div className="val" style={c.color ? { color: c.color } : undefined}>
            {c.val}
          </div>
        </div>
      ))}
    </div>
  );
}
