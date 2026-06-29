"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import useSWR, { mutate } from "swr";
import { Icon } from "@/components/Icon";
import { api } from "@/lib/api";
import { useProject } from "@/lib/useProject";
import { Markdown } from "./Markdown";
import { ThinkingIndicator } from "./ThinkingIndicator";

type Ref = { kind: string; label: string; href: string; icon: string };
type Msg = { role: "you" | "brain"; text: string; error?: boolean; detail?: string; refs?: Ref[] };

const NODE_ICON: Record<string, string> = {
  decision: "doc", feature: "spark", bug: "flag", metric: "graph", feedback: "flag", convention: "doc",
};
const nodeRef = (n: { id: string; type: string; label: string }): Ref => ({
  kind: n.type === "decision" ? "ADR" : n.type,
  label: n.label,
  href: n.type === "decision" ? `/decisions#dec-${n.id}` : `/brain?node=${n.id}`,
  icon: NODE_ICON[n.type] ?? "brain",
});
const taskRef = (t: { id: string; title: string }): Ref => ({
  kind: "task", label: `${t.id} · ${t.title}`, href: `/task/${t.id}`, icon: "tasks",
});

const ERROR_PRIMARY =
  "Sorry — the orchestrator hit an error and couldn't answer. Try again in a moment.";
const PREP_FAILED_MSG =
  "Couldn't start the orchestrator — the project may need a connected account";
const SPAWN_POLL_MS = 1500;
const SPAWN_TIMEOUT_MS = 60_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class OrchestratorPrepError extends Error {}

/**
 * The shared chat surface (reference `ChatPanel`) — the rich `.ch-*` message
 * stream + composer + the REAL orchestrator round-trip. Used inside the floating
 * bubble and the ⌘K side dock (`ChatBubble`). The header lives in BubbleHeader,
 * so this renders body-only.
 */
export function ChatPanel({ resetKey, onClose }: { resetKey?: number; onClose?: () => void }) {
  const { project } = useProject();
  const { data: accountsData } = useSWR("accounts", () => api.accounts());
  const noAccount = accountsData != null && accountsData.accounts.length === 0;

  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const sessionIdRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // "New thread" / project switch → clear the conversation.
  useEffect(() => { setMessages([]); setInput(""); }, [resetKey, project?.id]);
  useEffect(() => { sessionIdRef.current = null; }, [project?.id]);

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${ta.scrollHeight}px`;
  }, [input]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, status, busy]);

  const resolveOrchestrator = useCallback(async (): Promise<string> => {
    if (sessionIdRef.current) return sessionIdRef.current;
    if (!project) throw new Error("no project");
    const { sessions } = await api.sessions();
    const existing = sessions.find((s) => s.role === "orchestrator" && s.project_id === project.id && s.alive);
    if (existing) { sessionIdRef.current = existing.id; return existing.id; }
    setStatus("starting the orchestrator…");
    const spawned = await api.spawnOrchestrator(project.id, project.path);
    const id = spawned.id;
    const deadline = Date.now() + SPAWN_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const s = await api.session(id);
      if (s.prep === "ready") { sessionIdRef.current = id; setStatus(null); return id; }
      if (s.prep === "error") throw new OrchestratorPrepError(PREP_FAILED_MSG);
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
      await api.setCurrentProject(project.id);
      setStatus(null);
      // Snapshot the project's records so we can show whatever the agent CREATES
      // this turn (tasks / brain nodes) as clickable chips under the reply.
      const pid = project.id;
      const [t0, n0] = await Promise.all([api.tasks(pid), api.brainNodes(pid)]).catch(() => [null, null] as const);
      const beforeT = new Set((t0?.tasks ?? []).map((t) => t.id));
      const beforeN = new Set((n0?.nodes ?? []).map((n) => n.id));

      const framed =
        `[Spade context] Answer as the orchestrator for the project "${project.name}" ` +
        `(id: ${project.id}, path: ${project.path}). Treat THIS as the current project, ` +
        `ignoring any other default. If it has no data yet, say so plainly.\n\nQuestion: ${text}`;
      const { response } = await api.promptSession(id, framed);

      // Diff after the turn → the records the agent just created.
      let refs: Ref[] | undefined;
      try {
        const [t1, n1] = await Promise.all([api.tasks(pid), api.brainNodes(pid)]);
        const newNodes = n1.nodes.filter((n) => !beforeN.has(n.id));
        const newTasks = t1.tasks.filter((t) => !beforeT.has(t.id));
        const list = [...newNodes.map(nodeRef), ...newTasks.map(taskRef)];
        if (list.length) {
          refs = list;
          // Reflect the new records in the rest of the app (sidebar/pages).
          mutate(["tasks", pid]); mutate(["brain", pid]); mutate(["brain-edges", pid]);
        }
      } catch { /* chips are best-effort */ }

      setMessages((m) => [...m, { role: "brain", text: response, refs }]);
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      sessionIdRef.current = null;
      const friendly = err instanceof OrchestratorPrepError;
      setMessages((m) => [...m, friendly
        ? { role: "brain", text: raw, error: true }
        : { role: "brain", text: ERROR_PRIMARY, error: true, detail: raw }]);
    } finally {
      setBusy(false);
      setStatus(null);
    }
  }, [input, busy, project, noAccount, resolveOrchestrator]);

  function onKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); }
  }

  if (!project) return <div className="ch-empty" data-testid="ask-body"><Icon name="brain" size={18} /> Select a project to ask.</div>;
  if (noAccount) {
    return (
      <div className="ch-empty ch-no-account" data-testid="ask-body">
        <Icon name="brain" size={22} />
        <div style={{ maxWidth: 240, textAlign: "center" }}>
          No provider accounts yet. Connect one in Agent pool so the orchestrator has an account to run on.
        </div>
        <Link href="/agent-pool" className="btn primary sm">Go to Agent pool</Link>
      </div>
    );
  }

  return (
    <>
      <div className="ch-stream" ref={scrollRef} data-testid="ask-body">
        {messages.length === 0 && !busy && !status && (
          <div className="ch-empty"><Icon name="brain" size={18} /> Ask about this project — its backlog, brain, or what to do next.</div>
        )}
        {messages.map((m, i) => {
          const you = m.role === "you";
          return (
            <div className={"ch-msg ch-" + (you ? "user" : "assistant")} key={i} data-testid="ask-msg">
              <span className={"ch-msg-avatar " + (you ? "you" : "brain")} aria-hidden="true" data-testid="ask-msg-avatar">
                {you ? "RM" : <Icon name="brain" size={12} />}
              </span>
              <div className="ch-msg-body">
                <div className="ch-msg-h"><span className="ch-msg-who">{you ? "You" : "Spade · Claude"}</span></div>
                <div className={"ch-msg-text" + (m.error ? " ch-msg-error" : "")} title={m.detail ?? undefined}>
                  {m.role === "brain" && !m.error ? <Markdown>{m.text}</Markdown> : m.text}
                </div>
                {m.detail && <div className="ch-msg-detail">{m.detail}</div>}
                {m.refs && (
                  <div className="ch-refs" data-testid="ch-refs">
                    {m.refs.map((r) => (
                      <Link key={r.href} href={r.href} className="ch-ref" data-testid="ch-ref" onClick={() => onClose?.()}>
                        <Icon name={r.icon as never} size={12} />
                        <span className="ch-ref-kind mono">{r.kind}</span>
                        <span className="ch-ref-label">{r.label}</span>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {status ? <div className="ch-status">{status}</div> : busy ? <div className="ch-msg ch-assistant"><span className="ch-msg-avatar brain"><Icon name="brain" size={12} /></span><div className="ch-msg-body"><ThinkingIndicator /></div></div> : null}
      </div>

      <div className="ch-composer">
        <textarea
          ref={textareaRef}
          rows={1}
          placeholder="Ask about this project, or @mention an ADR/task/cluster"
          aria-label="Message"
          value={input}
          disabled={busy}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKey}
        />
        <div className="ch-composer-row">
          <span className="muted" style={{ fontSize: 11 }}>@ to mention · Enter to send · ⇧Enter newline</span>
          <button type="button" className="btn primary sm" data-testid="ask-send" aria-label="Send" disabled={busy || !input.trim()} onClick={() => void send()}>
            Send <Icon name="arrow" size={13} />
          </button>
        </div>
      </div>
    </>
  );
}
