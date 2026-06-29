"use client";

import * as React from "react";
import Link from "next/link";
import useSWR from "swr";
import { PageHead } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { useProject } from "@/lib/useProject";
import { api } from "@/lib/api";
import type { Meeting } from "@/lib/types";

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="muted" style={{ margin: "auto", padding: 24, fontSize: 13, textAlign: "center", color: "var(--text-4)" }}>
      {children}
    </div>
  );
}

// Split a transcript into lines, flagging the ones that carry an action (an
// arrow) so we can highlight them — the same lines the backlog was spun from.
function transcriptLines(transcript: string) {
  return transcript.split("\n").map((raw) => {
    const line = raw.trim();
    const action = line.includes("→");
    const [speaker, ...rest] = line.split(":");
    const hasSpeaker = rest.length > 0 && /^[A-Za-z][\w .'-]{0,30}$/.test(speaker);
    return {
      speaker: hasSpeaker ? speaker : "",
      text: hasSpeaker ? rest.join(":").trim() : line,
      action,
    };
  }).filter((l) => l.text);
}

// The ingest control: pick a "connected" notes source and pull it in. In the
// demo these are canned transcripts standing in for Granola / Otter / etc.
function IngestMenu({ projectId, onIngested }: { projectId: string; onIngested: (m: Meeting) => void }) {
  const { data } = useSWR("meeting-samples", () => api.meetingSamples());
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);
  const samples = data?.samples ?? [];

  async function ingest(sample: string) {
    setBusy(sample);
    try {
      const { meeting } = await api.ingestMeeting({ project_id: projectId, sample });
      setOpen(false);
      onIngested(meeting);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div style={{ position: "relative" }}>
      <button
        type="button"
        className="btn primary"
        data-testid="ingest-meeting"
        onClick={() => setOpen((v) => !v)}
        disabled={samples.length === 0}
      >
        <Icon name="mic" size={13} /> Ingest a meeting
      </button>
      {open && (
        <div className="ingest-menu" data-testid="ingest-menu">
          <div className="ingest-menu-head mono">Pull from a connected source</div>
          {samples.map((s) => (
            <button
              key={s.id}
              type="button"
              className="ingest-menu-item"
              data-testid="ingest-sample"
              onClick={() => ingest(s.id)}
              disabled={busy !== null}
            >
              <span className="ingest-menu-title">{s.title}</span>
              <span className="ingest-menu-sub mono">
                {busy === s.id ? "Ingesting…" : `${s.source} · ${s.date}`}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function MeetingsPage() {
  const { project } = useProject();
  const { data, mutate } = useSWR(
    project ? ["meetings", project.id] : null,
    () => api.meetings(project!.id),
  );
  // Tasks are fetched so we can show, on a meeting, the backlog items extracted
  // from it (grounded by origin_source === meeting title).
  const { data: taskData, mutate: mutateTasks } = useSWR(
    project ? ["tasks", project.id] : null,
    () => api.tasks(project!.id),
  );
  const meetings = data?.meetings ?? [];
  const tasks = taskData?.tasks ?? [];

  const [activeId, setActiveId] = React.useState<string | null>(null);
  const m = meetings.find((x) => x.id === activeId) ?? meetings[0] ?? null;

  // Backlog items this meeting produced — grounded back via origin_source.
  const fromMeeting = m ? tasks.filter((t) => t.origin_source === m.title) : [];

  async function handleIngested(meeting: Meeting) {
    await Promise.all([mutate(), mutateTasks()]);
    setActiveId(meeting.id);
  }

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <PageHead
        title="Meetings"
        actions={project ? <IngestMenu projectId={project.id} onIngested={handleIngested} /> : undefined}
      />
      {!project ? (
        <Empty>Select a project to see its meetings.</Empty>
      ) : !m ? (
        <Empty>
          No meetings captured yet.
          <br />
          Use <b>Ingest a meeting</b> to pull one in and watch it become backlog.
        </Empty>
      ) : (
        <div className="mtg-wrap" data-testid="meetings">
          {/* List */}
          <aside className="mtg-list">
            {meetings.map((mt) => (
              <button
                key={mt.id}
                className={"mtg-item" + (mt.id === m.id ? " on" : "")}
                data-testid="mtg-item"
                onClick={() => setActiveId(mt.id)}
              >
                <div className="mtg-item-title">{mt.title}</div>
                <div className="mtg-item-sub mono">
                  {mt.source ? `${mt.source} · ` : ""}{mt.attendees.length} attendees
                </div>
              </button>
            ))}
          </aside>

          {/* Detail */}
          <section className="mtg-detail" data-testid="mtg-detail">
            <h2 className="mtg-title">{m.title}</h2>
            <div className="muted mono" style={{ fontSize: 11.5 }}>
              {m.date ?? "—"}
              {m.source && <span className="mtg-source-badge">via {m.source}</span>}
            </div>
            <div className="mtg-attendees">
              {m.attendees.map((a) => (
                <span className="mtg-att" key={a}><span className="avatar" style={{ width: 18, height: 18, fontSize: 9 }}>{a.split(" ").map((w) => w[0]).join("").slice(0, 2)}</span>{a}</span>
              ))}
            </div>

            <div className="section-h">Summary</div>
            {m.summary ? (
              <div className="mtg-summary serif">{m.summary}</div>
            ) : (
              <div className="muted" style={{ fontSize: 12.5 }}>No summary yet.</div>
            )}

            {/* Backlog created from this meeting */}
            {fromMeeting.length > 0 && (
              <>
                <div className="section-h">
                  Backlog created<span className="count">{fromMeeting.length}</span>
                </div>
                <div className="mtg-backlog" data-testid="mtg-backlog">
                  {fromMeeting.map((t) => (
                    <Link key={t.id} href={`/task/${t.id}`} className="mtg-backlog-item" data-testid="mtg-backlog-item">
                      <Icon name="check" size={12} />
                      <span className="mono mtg-backlog-id">{t.id}</span>
                      <span className="mtg-backlog-title">{t.title}</span>
                      {t.origin_quote && <span className="mtg-backlog-quote">“{t.origin_quote}”</span>}
                    </Link>
                  ))}
                </div>
              </>
            )}

            {/* Transcript */}
            {m.transcript && (
              <>
                <div className="section-h">Transcript</div>
                <div className="mtg-transcript" data-testid="mtg-transcript">
                  {transcriptLines(m.transcript).map((l, i) => (
                    <div key={i} className={"mtg-line" + (l.action ? " hl" : "")}>
                      <span className="mtg-speaker">{l.speaker || "—"}</span>
                      <span>{l.text}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
