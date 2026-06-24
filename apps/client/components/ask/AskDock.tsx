"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { IconBtn } from "@/components/ui";
import { api } from "@/lib/api";
import { useAskDock } from "@/lib/useAskDock";
import { useProject } from "@/lib/useProject";

type Msg = { role: "you" | "brain"; text: string; error?: boolean };

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
    <div className={cls}>
      <div className="ask-msg-role">{msg.role === "you" ? "You" : "Brain"}</div>
      <div className="ask-msg-text">{msg.text}</div>
    </div>
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function AskDock() {
  const { open, setOpen } = useAskDock();
  const { project } = useProject();

  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  // Cached orchestrator session id (per resolved project) so repeat sends reuse it.
  const sessionIdRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

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
        throw new Error(
          "Couldn't start the orchestrator — the project may need a connected account",
        );
      }
      await sleep(SPAWN_POLL_MS);
    }
    throw new Error(
      "Couldn't start the orchestrator — the project may need a connected account",
    );
  }, [project]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || busy || !project) return;

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
      const message = err instanceof Error ? err.message : String(err);
      sessionIdRef.current = null; // force a fresh lookup next send
      setMessages((m) => [...m, { role: "brain", text: message, error: true }]);
    } finally {
      setBusy(false);
      setStatus(null);
    }
  }, [input, busy, project, resolveOrchestrator]);

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

            <div className="ask-composer">
              <textarea
                className="ask-input"
                placeholder="Ask the brain…"
                value={input}
                disabled={busy}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onComposerKey}
                rows={2}
              />
              <button
                type="button"
                className="btn ask-send"
                disabled={busy || !input.trim()}
                onClick={() => void send()}
              >
                Send
              </button>
            </div>
          </>
        )}
      </aside>
    </>
  );
}
