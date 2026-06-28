"use client";

import * as React from "react";
import { Icon } from "@/components/Icon";
import { DEMO_THREADS, type ChatMsg, type ChatThread } from "@/lib/demo";

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
            <div className="ch-action-btns">
              <button className="btn ghost">Reject</button>
              <button className="btn ghost">Modify</button>
              <button className="btn">Send to gates</button>
              <button className="btn primary">Apply</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function AskPage() {
  const threads = DEMO_THREADS;
  const [activeId, setActiveId] = React.useState(threads[0].id);
  const [query, setQuery] = React.useState("");

  const filtered = threads.filter((t) => t.title.toLowerCase().includes(query.toLowerCase()));
  const pinned = filtered.filter((t) => t.pinned);
  const recent = filtered.filter((t) => !t.pinned);
  const active = threads.find((t) => t.id === activeId) ?? threads[0];

  const ThreadItem = (t: ChatThread) => (
    <button
      key={t.id}
      className={"ask-thread" + (t.id === activeId ? " on" : "")}
      data-testid="ask-thread"
      onClick={() => setActiveId(t.id)}
    >
      <div className="ask-thread-title">{t.title}</div>
      <div className="ask-thread-sub mono">{t.project} · {t.updated}</div>
    </button>
  );

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
        <div className="ask-threads-group">Recent</div>
        {recent.map(ThreadItem)}
      </aside>

      {/* CENTER — chat panel */}
      <section className="ch-panel">
        <header className="ch-head">
          <div>
            <div className="ch-title">{active.title}</div>
            <div className="ch-subt mono">{active.messages.length} msgs · {active.project} · updated {active.updated}</div>
          </div>
        </header>
        <div className="ch-stream">
          {active.messages.map((m, i) => <Message key={i} m={m} />)}
        </div>
        <div className="ch-composer">
          <textarea rows={1} placeholder="Ask about this project, or @mention an ADR/task/cluster" aria-label="Message" />
          <div className="ch-composer-row">
            <span className="muted" style={{ fontSize: 11 }}>@ to mention · Enter to send · ⇧Enter newline</span>
            <button className="btn primary sm">Send →</button>
          </div>
        </div>
      </section>

      {/* RIGHT — context rail */}
      <aside className="ask-rail">
        <div className="ask-rail-h">Context</div>
        <div className="ask-rail-row"><span className="k">Project</span><span>{active.project}</span></div>
        <div className="ask-rail-row"><span className="k">Model</span><span className="mono">claude-opus-4</span></div>
        <div className="ask-rail-row"><span className="k">Sprint</span><span className="mono">26</span></div>
        <div className="ask-rail-h" style={{ marginTop: 18 }}>Recent actions</div>
        <div className="ask-rail-action">↳ ADR-031 edit drafted</div>
        <div className="ask-rail-action">↳ 12 feedback items clustered</div>
      </aside>
    </div>
  );
}
