"use client";

import { useEffect, useState } from "react";

// Whimsical, on-brand phrases for "asking the brain" — cycled like Claude Code's
// thinking line so the wait feels alive instead of a frozen "thinking…".
const PHRASES = [
  "Consulting the brain",
  "Reading the project",
  "Gathering context",
  "Connecting the dots",
  "Grounding the answer",
  "Synthesizing",
  "Thinking",
];

const CYCLE_MS = 2200;

export function ThinkingIndicator() {
  // Step sequentially through the array (modulo wrap) — no Math.random, so SSR
  // and the first client render agree.
  const [i, setI] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setI((n) => (n + 1) % PHRASES.length);
    }, CYCLE_MS);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="ask-thinking" aria-live="polite">
      <span className="ask-thinking-text">{PHRASES[i]}</span>
      <span className="ask-thinking-dots" aria-hidden="true">
        <span className="ask-thinking-dot" />
        <span className="ask-thinking-dot" />
        <span className="ask-thinking-dot" />
      </span>
    </div>
  );
}
