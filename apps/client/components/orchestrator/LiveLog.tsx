"use client";

import * as React from "react";
import type { OrchLogLine } from "@/lib/demo";

/** Animated streaming live-log (reference): replays seeded lines via setInterval
 *  with colored lvl-* levels + a blinking cursor. */
export function LiveLog({ logs }: { logs: OrchLogLine[] }) {
  const [n, setN] = React.useState(0);
  React.useEffect(() => {
    setN(0);
    const id = setInterval(() => setN((p) => (p < logs.length ? p + 1 : p)), 380);
    return () => clearInterval(id);
  }, [logs]);
  const shown = logs.slice(0, n).slice(-7);
  return (
    <div className="term term-mini" data-testid="live-log">
      {shown.map((l, i) => (
        <div className="tline" key={i}>
          <span className="ts">{l.t}</span>
          <span className={"lvl-" + l.lvl}>{l.lvl.padEnd(4)}</span>
          <span> {l.msg}</span>
        </div>
      ))}
      <div className="tline">
        <span className="ts blink">▌</span>
      </div>
    </div>
  );
}
