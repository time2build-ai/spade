import { stageVisual } from "@/lib/adapters";
import type { PipelineStage } from "@/lib/types";

/** Compact 4-segment stage bar for a pipeline card. */
export function StagesMini({ stages }: { stages: PipelineStage[] }) {
  return (
    <div className="stages-mini">
      {stages.map((s) => (
        <span
          key={s.id}
          className={stageVisual(s.state).key}
          data-testid="stage-seg"
        />
      ))}
    </div>
  );
}
