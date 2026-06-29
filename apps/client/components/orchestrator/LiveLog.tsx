"use client";

import { useRef } from "react";
import useSWR from "swr";
import { api } from "@/lib/api";

/**
 * Live log driven by the REAL agent session screen (GET /sessions/:id/screen),
 * polled. No scripted lines: when there is no live session for the run we show
 * an honest idle state instead of replaying a seeded transcript.
 */
export function LiveLog({ sessionId }: { sessionId: string | null }) {
  const lastGood = useRef<string>("");
  const { data, error } = useSWR(
    sessionId ? ["live-log-screen", sessionId] : null,
    () => api.sessionScreen(sessionId!),
    { refreshInterval: 2500 },
  );

  if (!sessionId) {
    return (
      <div className="term term-mini" data-testid="live-log">
        <div className="tline">
          <span className="term-empty">No live output — no agent session for this run.</span>
        </div>
      </div>
    );
  }

  if (typeof data === "string") lastGood.current = data;
  const text = typeof data === "string" ? data : lastGood.current;

  return (
    <div className="term term-mini" data-testid="live-log">
      {error && !lastGood.current ? (
        <div className="tline">
          <span className="term-empty">Live output unavailable.</span>
        </div>
      ) : (
        text
      )}
    </div>
  );
}
