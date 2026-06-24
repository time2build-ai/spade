"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { Icon } from "@/components/Icon";
import { IconBtn } from "@/components/ui";
import { api } from "@/lib/api";
import { useAskDock } from "@/lib/useAskDock";
import { useProject } from "@/lib/useProject";

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
  return (
    <div className={cls} title={msg.detail ?? undefined}>
      <div className="ask-msg-role">{msg.role === "you" ? "You" : "Brain"}</div>
      <div className="ask-msg-text">{msg.text}</div>
      {msg.detail && <div className="ask-msg-detail">{msg.detail}</div>}
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
      setStatus("thinking…");
      const { response } = await api.promptSession(id, text);
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

  if (!open) return null;

  return (
    <>
      <div className="ask-overlay" onClick={() => setOpen(false)} />
      <aside className="ask-dock" role="dialog" aria-label="Ask the brain">
        <header className="ask-head">
          <div className="ask-head-titles">
            <span className="ask-head-title">Ask the brain</span>
            {project && <span className="ask-head-proj">{project.name}</span>}
          </div>
          <IconBtn icon="x" title="Close" onClick={() => setOpen(false)} />
        </header>

        {!project ? (
          <div className="ask-body ask-empty">Select a project to ask.</div>
        ) : noAccount ? (
          <div className="ask-body ask-no-account">
            <div className="ask-no-account-icon" aria-hidden="true">
              <Icon name="brain" size={22} />
            </div>
            <div className="ask-no-account-text">
              No provider accounts configured yet. Add one in Agent pool so the
              orchestrator has an account to run on.
            </div>
            <Link href="/agent-pool" className="btn primary sm">
              Go to Agent pool
            </Link>
          </div>
        ) : (
          <>
            <div className="ask-body" ref={scrollRef}>
              {messages.length === 0 && !status && (
                <div className="ask-hint">Ask the orchestrator about this project…</div>
              )}
              {messages.map((m, i) => (
                <MessageBubble key={i} msg={m} />
              ))}
              {status && <div className="ask-status">{status}</div>}
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
      </aside>
    </>
  );
}
