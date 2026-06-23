"use client";

import { useRef } from "react";
import useSWR from "swr";
import { api } from "@/lib/api";

/** Live agent terminal screen (plain text, polled). */
export function Terminal({ sessionId }: { sessionId: string | null }) {
  const lastGood = useRef<string>("");

  const { data, error } = useSWR(
    sessionId ? ["session-screen", sessionId] : null,
    () => api.sessionScreen(sessionId!),
    { refreshInterval: 2500 },
  );

  if (!sessionId) {
    return (
      <div className="term">
        <span className="term-empty">no live session</span>
      </div>
    );
  }

  if (typeof data === "string") lastGood.current = data;

  // On a fetch error, fall back to the last good screen; otherwise a notice.
  const text = typeof data === "string" ? data : lastGood.current;

  return (
    <div className="term" data-testid="terminal">
      {error && !lastGood.current ? (
        <span className="term-empty">terminal unavailable</span>
      ) : (
        text
      )}
    </div>
  );
}
