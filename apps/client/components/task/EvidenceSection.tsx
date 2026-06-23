import * as React from "react";
import { Icon } from "@/components/Icon";
import type { IconName } from "@/components/Icon";
import type { BrainNode, BrainNodeType } from "@/lib/types";

/** Per-type token color + icon + soft icon-tile background, matching .lr-icon. */
const TYPE_STYLE: Record<BrainNodeType, { color: string; tile: string; icon: IconName }> = {
  feature: { color: "var(--accent)", tile: "rgba(201,184,255,.12)", icon: "spark" },
  decision: { color: "var(--amber)", tile: "rgba(230,184,106,.12)", icon: "doc" },
  feedback: { color: "var(--blue)", tile: "rgba(122,182,230,.12)", icon: "spark" },
  bug: { color: "var(--red)", tile: "rgba(232,125,125,.12)", icon: "flag" },
  metric: { color: "var(--teal)", tile: "rgba(122,220,199,.12)", icon: "graph" },
  convention: { color: "var(--pink)", tile: "rgba(230,155,182,.12)", icon: "link" },
};

export interface EvidenceSectionProps {
  title: string;
  type: BrainNodeType;
  nodes: BrainNode[];
}

/**
 * A titled evidence section (`.section-h` eyebrow + `.link-row` items) listing
 * linked brain nodes of one type. Honest empty state: zero nodes renders a
 * muted "No linked {title}" placeholder rather than being omitted silently.
 */
export function EvidenceSection({ title, type, nodes }: EvidenceSectionProps) {
  const style = TYPE_STYLE[type];

  return (
    <section>
      <div className="section-h">
        {title}
        {nodes.length > 0 ? (
          <span className="count">{nodes.length}</span>
        ) : null}
      </div>
      {nodes.length === 0 ? (
        <div className="section-empty">No linked {title.toLowerCase()}</div>
      ) : (
        nodes.map((node) => (
          <div className="link-row" key={node.id}>
            <span
              className="lr-icon"
              style={{ background: style.tile, color: style.color }}
            >
              <Icon name={style.icon} />
            </span>
            <div>
              <div className="lr-title">{node.label}</div>
              {node.detail ? (
                <div className="lr-sub">{node.detail}</div>
              ) : null}
            </div>
          </div>
        ))
      )}
    </section>
  );
}
