"use client";

import * as React from "react";
import useSWR from "swr";
import { PageHead } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { GateCard } from "@/components/gate/GateCard";
import { api } from "@/lib/api";

function StateMessage({ children }: { children: React.ReactNode }) {
  return <div className="gate-empty">{children}</div>;
}

export default function GatePage() {
  // Brakes are global orchestrator state — no project scoping. Poll so
  // newly-raised gates appear without a manual refresh.
  const { data, error, isLoading, mutate } = useSWR(
    "brakes",
    () => api.brakes(),
    { refreshInterval: 4000 },
  );

  const brakes = data?.brakes ?? [];

  const onAllow = async (id: string) => {
    await api.allowBrake(id);
    await mutate();
  };
  const onSkip = async (id: string) => {
    await api.skipBrake(id);
    await mutate();
  };

  let body: React.ReactNode;
  if (error) {
    body = (
      <StateMessage>
        <span style={{ color: "var(--red)" }}>
          Couldn’t load gates: {String(error.message ?? error)}
        </span>
      </StateMessage>
    );
  } else if (isLoading || !data) {
    body = <StateMessage>Loading…</StateMessage>;
  } else if (brakes.length === 0) {
    body = (
      <StateMessage>
        No gates awaiting approval — the fleet is clear.
      </StateMessage>
    );
  } else {
    body = (
      <div className="gate-list">
        {brakes.map((brake) => (
          <GateCard
            key={brake.id}
            brake={brake}
            onAllow={onAllow}
            onSkip={onSkip}
          />
        ))}
      </div>
    );
  }

  const count = data ? brakes.length : undefined;

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <PageHead
        title={
          <>
            Human gates
            {count !== undefined && (
              <span className="muted" style={{ fontWeight: 400 }}>
                {" "}
                · {count} pending
              </span>
            )}
          </>
        }
      />
      <div className="gate-wrap">
        <div className="gate-banner">
          <div className="gicon">
            <Icon name="gate" className="ico" />
          </div>
          <div>
            <h2>Actions awaiting your approval</h2>
            <p>
              The orchestrator raised a brake on an action that needs a human
              call. Allow to resume it, or skip to reject and continue.
            </p>
          </div>
        </div>
        {body}
      </div>
    </div>
  );
}
