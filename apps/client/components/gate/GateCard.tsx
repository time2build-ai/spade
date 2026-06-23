"use client";

import * as React from "react";
import { Btn, Card } from "@/components/ui";
import { Icon } from "@/components/Icon";
import type { Brake } from "@/lib/types";

export interface GateCardProps {
  brake: Brake;
  onAllow: (id: string) => void | Promise<void>;
  onSkip: (id: string) => void | Promise<void>;
}

/** Turn a brake type like "opus_spawn" into a readable label "Opus spawn". */
export function formatBrakeType(brake: string): string {
  const spaced = brake.replace(/[_-]+/g, " ").trim();
  if (!spaced) return brake;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * One pending brake (human gate) rendered as an amber approval card.
 *
 * The honest backend fields are: `brake` (gate type, shown as the eyebrow),
 * `detail` (human explanation, the body), and `mission`/`worker` (mono meta).
 * Two actions resume or reject the gated orchestrator action.
 */
export function GateCard({ brake, onAllow, onSkip }: GateCardProps) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const run = async (action: (id: string) => void | Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action(brake.id);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
      setBusy(false);
    }
    // On success the card is typically unmounted (brake removed); no need to
    // clear `busy`, which keeps the buttons disabled during the revalidation.
  };

  return (
    <Card className="gate-card">
      <div className="gate-card-main">
        <div className="gate-card-eyebrow">{formatBrakeType(brake.brake)}</div>
        <p className="gate-card-detail">{brake.detail}</p>
        <div className="gate-card-meta">
          <span className="mono">{brake.mission}</span>
          {brake.worker && (
            <>
              <span className="gate-card-meta-sep">·</span>
              <span className="mono">{brake.worker}</span>
            </>
          )}
        </div>
        {error && <p className="gate-card-error">{error}</p>}
      </div>
      <div className="gate-card-actions">
        <Btn
          variant="primary"
          disabled={busy}
          onClick={() => run(onAllow)}
        >
          <Icon name="check" className="ico" /> Allow
        </Btn>
        <Btn variant="ghost" disabled={busy} onClick={() => run(onSkip)}>
          Skip
        </Btn>
      </div>
    </Card>
  );
}
