import * as React from "react";
import { Card, Chip } from "@/components/ui";
import { Icon } from "@/components/Icon";
import type { BrainNode } from "@/lib/types";

export interface DecisionCardProps {
  node: BrainNode;
}

/**
 * One decision-type brain node rendered as a dense ADR card.
 *
 * We only have three honest fields from the API — `id`, `label`, `detail` —
 * so the rich handoff card is adapted down to: an amber "ADR" decision chip,
 * the label as the title (with a doc icon), and the detail as a muted body
 * (omitted entirely when null).
 */
export function DecisionCard({ node }: DecisionCardProps) {
  return (
    <Card className="decision-card">
      <div className="decision-card-head">
        <Chip type="decision">ADR</Chip>
        <span className="decision-card-id mono">{node.id}</span>
      </div>
      <div className="decision-card-title">
        <Icon name="doc" className="ico" />
        <span>{node.label}</span>
      </div>
      {node.detail && <p className="decision-card-detail muted">{node.detail}</p>}
    </Card>
  );
}
