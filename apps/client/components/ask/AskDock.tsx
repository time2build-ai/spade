"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { Icon } from "@/components/Icon";
import { api } from "@/lib/api";
import { useAskDock } from "@/lib/useAskDock";
import { useProject } from "@/lib/useProject";
import { Markdown } from "./Markdown";
import { ThinkingIndicator } from "./ThinkingIndicator";

type Msg = { role: "you" | "brain"; text: string; error?: boolean; detail?: string };

// Friendly copy for a failed prompt/spawn. The raw error is kept as `detail`
// (a muted line + tooltip) so the bubble is human-readable but still honest.
const ERROR_PRIMARY =
  "Sorry — the orchestrator hit an error and couldn't answer. Try again in a moment.";

const SPAWN_POLL_MS = 1500;
const SPAWN_TIMEOUT_MS = 60_000;

function MessageBubble({ msg }: { msg: Msg }) {
  const cls = [
    "ask-msg",
    msg.role === "you" ? "ask-msg-you" : "ask-msg-brain",
    msg.error ? "ask-msg-error" : "",
  ]
    .filter(Boolean)
    .join(" ");
  // Successful brain replies render as Markdown (the orchestrator emits
  // structured output). User messages and the short friendly-error prose stay
  // plain text so the text sits directly on `.ask-msg-text` (preserves the
  // class hook used by tests + avoids markdown wrapping short error copy).
  const asMarkdown = msg.role === "brain" && !msg.error;
  const isYou = msg.role === "you";
  // Avatar + bubble row (reference Message anatomy): assistant avatar on the
  // left, user avatar on the right.
  return (
    <div className={"ask-msg-row " + (isYou ? "ask-msg-row-you" : "ask-msg-row-brain")}>
      <span
        className={"ask-msg-avatar " + (isYou ? "you" : "brain")}
        data-testid="ask-msg-avatar"
        aria-hidden="true"
      >
        {isYou ? "you" : <Icon name="brain" size={12} />}
      </span>
      <div className={cls} title={msg.detail ?? undefined}>
        <div className="ask-msg-role">{isYou ? "You" : "Brain"}</div>
        <div className="ask-msg-text">
          {asMarkdown ? <Markdown>{msg.text}</Markdown> : msg.text}
        </div>
        {msg.detail && <div className="ask-msg-detail">{msg.detail}</div>}
      </div>
    </div>
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Thrown when the orchestrator can't be prepped (spawn timeout or prep error).
// Its message is already human-friendly, so the catch path surfaces it as-is
// rather than swapping in the generic error copy.
class OrchestratorPrepError extends Error {}

const PREP_FAILED_MSG =
  "Couldn't start the orchestrator — the project may need a connected account";

export function AskDock() {
  const { open, setOpen } = useAskDock();
  const { project } = useProject();

  // Gate on whether ANY provider account exists (global). When the project's
  // own pool is empty the orchestrator falls back to the default account, so we
  // only block when there are no accounts at all — otherwise asking works.
  const { data: accountsData } = useSWR(open ? "accounts" : null, () => api.accounts());
  const noAccount = accountsData != null && accountsData.accounts.length === 0;

  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  // Cached orchestrator session id (per resolved project) so repeat sends reuse it.
  const sessionIdRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const floatRef = useRef<HTMLDivElement | null>(null);

  // Floating-companion UI state: collapsed (card hidden, just the pill) and a
  // dragged position (null = default top-center). Both persist across sessions.
  const [collapsed, setCollapsed] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    try {
      const p = localStorage.getItem("spade-ask-pos");
      if (p) setPos(JSON.parse(p));
      setCollapsed(localStorage.getItem("spade-ask-collapsed") === "1");
    } catch {
      /* ignore malformed storage */
    }
  }, []);

  const applyCollapsed = useCallback((next: boolean) => {
    setCollapsed(next);
    try {
      localStorage.setItem("spade-ask-collapsed", next ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, []);

  const toggleCollapsed = useCallback(
    () => setCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem("spade-ask-collapsed", next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    }),
    [],
  );

  // Opening the dock (⌘K, the topbar bar, anything) always shows it expanded —
  // a persisted/collapsed state shouldn't force an extra "Show" click.
  const wasOpen = useRef(open);
  useEffect(() => {
    if (open && !wasOpen.current) applyCollapsed(false);
    wasOpen.current = open;
  }, [open, applyCollapsed]);

  // Click anywhere outside the companion collapses it down to the pill (not a
  // full close — Escape / the × do that). Only armed while the card is open.
  useEffect(() => {
    if (!open || collapsed) return;
    function onPointerDown(e: MouseEvent) {
      if (floatRef.current && !floatRef.current.contains(e.target as Node)) {
        applyCollapsed(true);
      }
    }
    window.addEventListener("mousedown", onPointerDown);
    return () => window.removeEventListener("mousedown", onPointerDown);
  }, [open, collapsed, applyCollapsed]);

  // Drag the whole companion by its handle pill. Buttons on the pill opt out.
  const onHandleDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest(".ask-hbtn")) return;
    const el = floatRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const offX = e.clientX - rect.left;
    const offY = e.clientY - rect.top;
    e.preventDefault();
    const move = (ev: MouseEvent) => {
      const x = Math.max(8, Math.min(ev.clientX - offX, window.innerWidth - rect.width - 8));
      const y = Math.max(8, Math.min(ev.clientY - offY, window.innerHeight - rect.height - 8));
      setPos({ x, y });
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      setPos((p) => {
        if (p) {
          try {
            localStorage.setItem("spade-ask-pos", JSON.stringify(p));
          } catch {
            /* ignore */
          }
        }
        return p;
      });
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }, []);

  // Auto-grow the composer textarea (min ~1 row, capped by max-height in CSS,
  // then it scrolls).
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${ta.scrollHeight}px`;
  }, [input]);

  // Global ⌘K / Ctrl+K toggle + Escape to close.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(!open);
      } else if (e.key === "Escape" && open) {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  // If the active project changes, drop the cached session id.
  useEffect(() => {
    sessionIdRef.current = null;
  }, [project?.id]);

  // Keep the conversation scrolled to the bottom.
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, status]);

  const resolveOrchestrator = useCallback(async (): Promise<string> => {
    if (sessionIdRef.current) return sessionIdRef.current;
    if (!project) throw new Error("no project");

    const { sessions } = await api.sessions();
    const existing = sessions.find(
      (s) => s.role === "orchestrator" && s.project_id === project.id && s.alive,
    );
    if (existing) {
      sessionIdRef.current = existing.id;
      return existing.id;
    }

    // Auto-spawn and poll prep until ready.
    setStatus("starting the orchestrator…");
    const spawned = await api.spawnOrchestrator(project.id, project.path);
    const id = spawned.id;
    const deadline = Date.now() + SPAWN_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const s = await api.session(id);
      if (s.prep === "ready") {
        sessionIdRef.current = id;
        setStatus(null);
        return id;
      }
      if (s.prep === "error") {
        throw new OrchestratorPrepError(PREP_FAILED_MSG);
      }
      await sleep(SPAWN_POLL_MS);
    }
    throw new OrchestratorPrepError(PREP_FAILED_MSG);
  }, [project]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || busy || !project || noAccount) return;

    setMessages((m) => [...m, { role: "you", text }]);
    setInput("");
    setBusy(true);
    setStatus(null);

    try {
      const id = await resolveOrchestrator();
      // Point the server's "current project" at the selected one so the
      // orchestrator's spade-data tools answer about THIS project, then frame
      // the question with explicit project context (belt and suspenders).
      await api.setCurrentProject(project.id);
      // Clear the spawn label and enter the "thinking" phase — the dock renders
      // the animated <ThinkingIndicator/> while `busy` is true and there's no
      // spawn status line.
      setStatus(null);
      const framed =
        `[Spade context] Answer as the orchestrator for the project "${project.name}" ` +
        `(id: ${project.id}, path: ${project.path}). Treat THIS as the current project, ` +
        `ignoring any other default. If it has no data yet, say so plainly.\n\n` +
        `Question: ${text}`;
      const { response } = await api.promptSession(id, framed);
      setMessages((m) => [...m, { role: "brain", text: response }]);
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      sessionIdRef.current = null; // force a fresh lookup next send
      // resolveOrchestrator throws an already-friendly message for the
      // spawn-timeout / prep==="error" case; surface that as-is. Everything
      // else (e.g. a raw "500 Internal Server Error") gets the generic
      // human-readable copy, with the raw text kept as a muted detail line.
      const friendly = err instanceof OrchestratorPrepError;
      setMessages((m) => [
        ...m,
        friendly
          ? { role: "brain", text: raw, error: true }
          : { role: "brain", text: ERROR_PRIMARY, error: true, detail: raw },
      ]);
    } finally {
      setBusy(false);
      setStatus(null);
    }
  }, [input, busy, project, noAccount, resolveOrchestrator]);

  function onComposerKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  // Closed → a persistent bottom-right trigger pill (reference ChatBubble
  // launcher). Clicking it (or ⌘K) opens the dock.
  if (!open) {
    return (
      <button
        type="button"
        className="ask-trigger"
        data-testid="ask-trigger"
        aria-label="Ask the brain"
        onClick={() => setOpen(true)}
      >
        <Icon name="brain" size={15} />
        <span className="ask-trigger-label">Ask the brain</span>
        <span className="ask-trigger-kbd mono">⌘K</span>
      </button>
    );
  }

  return (
    <div
      ref={floatRef}
      className={["ask-float", pos ? "placed" : ""].filter(Boolean).join(" ")}
      style={pos ? { left: pos.x, top: pos.y } : undefined}
      role="dialog"
      aria-label="Ask the brain"
    >
      <div className="ask-float-inner">
        {/* Control pill — drag handle + hide/close. */}
        <div className="ask-handle" onMouseDown={onHandleDown}>
          <span className="ask-handle-mk" aria-hidden="true">
            <Icon name="brain" size={13} />
          </span>
          <span className="ask-handle-grip" aria-hidden="true">
            <i /><i /><i /><i /><i /><i />
          </span>
          <button type="button" className="ask-hbtn" onClick={toggleCollapsed}>
            {collapsed ? "▸ Show" : "▾ Hide"}
          </button>
          <span className="ask-handle-label">
            Ask the brain
            {project && <span className="ask-handle-proj">{project.name}</span>}
          </span>
          <button
            type="button"
            className="ask-hbtn ask-hbtn-icon"
            aria-label="Close"
            title="Close"
            onClick={() => setOpen(false)}
          >
            <Icon name="x" size={13} />
          </button>
        </div>

        {/* Glass card — animates closed when collapsed (kept mounted so the
            collapse/expand micro-animation can play). */}
        <div
          className={["ask-card", collapsed ? "is-collapsed" : ""].filter(Boolean).join(" ")}
          aria-hidden={collapsed}
        >
            {!project ? (
              <div className="ask-body ask-empty">Select a project to ask.</div>
            ) : noAccount ? (
              <div className="ask-body ask-no-account">
                <div className="ask-no-account-icon" aria-hidden="true">
                  <Icon name="brain" size={22} />
                </div>
                <div className="ask-no-account-text">
                  No provider accounts configured yet. Add one in Agent pool so
                  the orchestrator has an account to run on.
                </div>
                <Link href="/agent-pool" className="btn primary sm">
                  Go to Agent pool
                </Link>
              </div>
            ) : (
              <>
                <div className="ask-body" ref={scrollRef}>
                  {messages.length === 0 && !status && !busy && (
                    <div className="ask-hint">
                      Ask the orchestrator about this project…
                    </div>
                  )}
                  {messages.map((m, i) => (
                    <MessageBubble key={i} msg={m} />
                  ))}
                  {/* Spawning shows a plain status line; the thinking phase
                      (busy with no spawn label) shows the animated indicator. */}
                  {status ? (
                    <div className="ask-status">{status}</div>
                  ) : busy ? (
                    <ThinkingIndicator />
                  ) : null}
                </div>

                <div className="ask-composer-wrap">
                  <div className="ask-composer">
                    <textarea
                      ref={textareaRef}
                      className="ask-input"
                      placeholder="Ask the brain…"
                      value={input}
                      disabled={busy}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyDown={onComposerKey}
                      rows={1}
                    />
                    <div className="ask-composer-row">
                      <span className="ask-composer-hint">⇧↵ for newline</span>
                      <button
                        type="button"
                        className="ask-send"
                        aria-label="Send"
                        title="Send"
                        disabled={busy || !input.trim()}
                        onClick={() => void send()}
                      >
                        <Icon name="arrow" size={15} className="ask-send-icon" />
                      </button>
                    </div>
                  </div>
                </div>
              </>
            )}
        </div>
      </div>
    </div>
  );
}
