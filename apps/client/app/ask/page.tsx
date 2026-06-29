"use client";

import * as React from "react";
import useSWR from "swr";
import { Icon } from "@/components/Icon";
import { useProject } from "@/lib/useProject";
import { api } from "@/lib/api";
import type { ChatMessageReal } from "@/lib/types";

type Cite = string;
type ChatMsg = {
  role: "user" | "assistant";
  who: string;
  t: string;
  text: string;
  cites?: Cite[];
  plan?: { title: string; steps: string[] };
  action?: { kind: string; id: string; risk: string; title: string; remove: string[]; add: string[] };
};
type ChatThread = { id: string; title: string; project: string; updated: string; pinned: boolean };

// Map a persisted chat message → the Message component's shape (payload carries
// the structured cites/plan/action cards, when the agent emitted them).
function toMsg(m: ChatMessageReal): ChatMsg {
  const t = m.created_at
    ? new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "";
  return {
    role: m.role === "user" ? "user" : "assistant",
    who: m.who ?? "", t, text: m.text ?? "",
    cites: m.payload?.cites, plan: m.payload?.plan, action: m.payload?.action,
  };
}

function Message({ m }: { m: ChatMsg }) {
  const isUser = m.role === "user";
  return (
    <div className={"ch-msg ch-" + m.role}>
      <span className={"ch-msg-avatar " + (isUser ? "you" : "brain")} aria-hidden="true">
        {isUser ? "RM" : <Icon name="brain" size={12} />}
      </span>
      <div className="ch-msg-body">
        <div className="ch-msg-h">
          <span className="ch-msg-who">{m.who}</span>
          <span className="ch-msg-t mono">{m.t}</span>
        </div>
        <div className="ch-msg-text">{m.text}</div>

        {m.cites && (
          <div className="ch-cites">
            {m.cites.map((c) => (
              <span className="ch-cite mono" key={c}>↳ {c}</span>
            ))}
          </div>
        )}

        {m.plan && (
          <div className="ch-plan" data-testid="ch-plan">
            <div className="ch-plan-h">PLAN · {m.plan.title}</div>
            <ol className="ch-plan-steps">
              {m.plan.steps.map((s, i) => <li key={i}>{s}</li>)}
            </ol>
          </div>
        )}

        {m.action && (
          <div className="ch-action" data-testid="ch-action">
            <div className="ch-action-h">
              <span className="ch-action-tag">{m.action.kind}</span>
              <span className="mono">{m.action.id}</span>
              <span className="ch-action-risk mono">risk: {m.action.risk}</span>
            </div>
            <div className="ch-action-title">{m.action.title}</div>
            <div className="ch-diff">
              <div className="ch-diff-h">DECISION DRIVERS</div>
              {m.action.remove.map((l, i) => <div className="ch-diff-line del" key={"r" + i}>- {l}</div>)}
              {m.action.add.map((l, i) => <div className="ch-diff-line add" key={"a" + i}>+ {l}</div>)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function AskPage() {
  const { project } = useProject();
  const { data: threadsData, isLoading } = useSWR(
    project ? ["chat-threads", project.id] : null,
    () => api.chatThreads(project!.id),
  );
  const projName = project?.name ?? "Workspace";

  const threads: ChatThread[] = (threadsData?.threads ?? []).map((t) => ({
    id: t.id,
    title: t.title ?? "Untitled",
    project: projName,
    updated: t.updated_at ? new Date(t.updated_at).toLocaleDateString() : "",
    pinned: t.pinned === 1,
  }));

  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState("");

  const filtered = threads.filter((t) => t.title.toLowerCase().includes(query.toLowerCase()));
  const pinned = filtered.filter((t) => t.pinned);
  const recent = filtered.filter((t) => !t.pinned);
  const active = threads.find((t) => t.id === activeId) ?? threads[0] ?? null;

  const { data: msgData } = useSWR(
    active ? ["chat-messages", active.id] : null,
    () => api.chatMessages(active!.id),
  );
  const messages: ChatMsg[] = (msgData?.messages ?? []).map(toMsg);

  const ThreadItem = (t: ChatThread) => (
    <button
      key={t.id}
      className={"ask-thread" + (t.id === active?.id ? " on" : "")}
      data-testid="ask-thread"
      onClick={() => setActiveId(t.id)}
    >
      <div className="ask-thread-title">{t.title}</div>
      <div className="ask-thread-sub mono">{t.project} · {t.updated}</div>
    </button>
  );

  // No saved threads yet — point people at the floating Ask companion (the live chat).
  const emptyThreads = !isLoading && threads.length === 0;

  return (
    <div className="ask-page" data-testid="ask-page">
      {/* LEFT — thread list */}
      <aside className="ask-threads">
        <div className="ask-threads-search">
          <Icon name="search" size={12} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search threads…" aria-label="Search threads" />
        </div>
        {pinned.length > 0 && (
          <>
            <div className="ask-threads-group">Pinned</div>
            {pinned.map(ThreadItem)}
          </>
        )}
        {recent.length > 0 && <div className="ask-threads-group">Recent</div>}
        {recent.map(ThreadItem)}
        {emptyThreads && (
          <div className="muted" data-testid="ask-threads-empty" style={{ padding: "14px 12px", fontSize: 12.5, lineHeight: 1.6 }}>
            {project ? "No saved threads yet. Use the Ask companion (⌘K) to start a conversation." : "Select a project to see its threads."}
          </div>
        )}
      </aside>

      {/* CENTER — chat panel */}
      <section className="ch-panel">
        {active ? (
          <>
            <header className="ch-head">
              <div>
                <div className="ch-title">{active.title}</div>
                <div className="ch-subt mono">{messages.length} msgs · {active.project} · updated {active.updated}</div>
              </div>
            </header>
            <div className="ch-stream">
              {messages.length ? messages.map((m, i) => <Message key={i} m={m} />)
                : <div className="muted" style={{ padding: 24, fontSize: 12.5 }}>No messages in this thread yet.</div>}
            </div>
          </>
        ) : (
          <div className="ch-stream">
            <div className="muted" style={{ padding: 40, fontSize: 13, textAlign: "center" }}>
              <Icon name="brain" size={20} />
              <div style={{ marginTop: 10 }}>
                {project ? "No thread selected. Start one with the Ask companion (⌘K)." : "Select a project to ask about it."}
              </div>
            </div>
          </div>
        )}
        <div className="ch-composer">
          <textarea rows={1} placeholder="Ask about this project, or @mention an ADR/task/cluster" aria-label="Message" />
          <div className="ch-composer-row">
            <span className="muted" style={{ fontSize: 11 }}>@ to mention · Enter to send · ⇧Enter newline</span>
            <button className="btn primary sm">Send →</button>
          </div>
        </div>
      </section>

      {/* RIGHT — context rail (real project) */}
      <aside className="ask-rail">
        <div className="ask-rail-h">Context</div>
        <div className="ask-rail-row"><span className="k">Project</span><span>{projName}</span></div>
        {active ? <div className="ask-rail-row"><span className="k">Thread</span><span className="mono">{active.id.slice(0, 8)}</span></div> : null}
        <div className="ask-rail-row"><span className="k">Updated</span><span className="mono">{active?.updated ?? "—"}</span></div>
      </aside>
    </div>
  );
}
