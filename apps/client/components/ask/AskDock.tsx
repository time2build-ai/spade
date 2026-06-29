"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { Icon } from "@/components/Icon";
import { api } from "@/lib/api";
import { useAskDock } from "@/lib/useAskDock";
import { useProject } from "@/lib/useProject";
import { ChatPanel } from "./ChatPanel";

type Mode = null | "bubble" | "dock";

/**
 * ChatBubble (reference `mod_12`): a bottom-right accent pill that expands into a
 * floating 440×620 bubble, and ⌘K opens it as a right-edge side dock. Both share
 * one `BubbleHeader` (thread picker + actions) and the rich `ChatPanel`. Hidden at
 * the workspace level. Exported as `AskDock` (the layout's mount point).
 */
export function AskDock() {
  const { open, setOpen } = useAskDock();
  const { project } = useProject();
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(null);
  const [resetKey, setResetKey] = useState(0);

  // Bridge the shared open-state (topbar "Ask the brain…" pill) → the side dock,
  // and mirror our mode back so the store stays in sync.
  useEffect(() => { if (open && mode === null) setMode("dock"); }, [open, mode]);
  const go = useCallback((m: Mode) => { setMode(m); setOpen(m !== null); }, [setOpen]);

  // ⌘K toggles the dock; Esc closes.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setMode((m) => { const next: Mode = m === "dock" ? null : "dock"; setOpen(next !== null); return next; });
      } else if (e.key === "Escape" && mode) {
        go(null);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, go, setOpen]);

  const newThread = () => { setResetKey((k) => k + 1); };
  const openAsPage = () => { go(null); router.push("/ask"); };

  // Trigger pill — shown only when nothing is open.
  if (mode === null) {
    return (
      <button type="button" className="ch-bubble" data-testid="ask-trigger" aria-label="Ask Spade" title="Ask Spade (⌘K)" onClick={() => go("bubble")}>
        <Icon name="spark" size={14} />
        <span>Ask</span>
        <span className="ch-bubble-kbd mono">⌘K</span>
      </button>
    );
  }

  const header = (
    <BubbleHeader
      project={project?.name ?? "Ask Spade"}
      projectId={project?.id ?? null}
      dock={mode === "dock"}
      onNew={newThread}
      onOpenPage={openAsPage}
      onDock={() => go("dock")}
      onFloat={() => go("bubble")}
      onClose={() => go(null)}
      router={router}
    />
  );

  if (mode === "bubble") {
    return (
      <div className="ch-bubble-panel" data-testid="ask-dock" role="dialog" aria-label="Ask Spade">
        {header}
        <div className="ch-bubble-body"><div className="ch-panel"><ChatPanel resetKey={resetKey} onClose={() => go(null)} /></div></div>
      </div>
    );
  }

  return (
    <>
      <div className="ch-dock-overlay" onClick={() => go(null)} />
      <div className="ch-dock" data-testid="ask-dock" role="dialog" aria-label="Ask Spade">
        {header}
        <div className="ch-dock-body"><div className="ch-panel"><ChatPanel resetKey={resetKey} onClose={() => go(null)} /></div></div>
      </div>
    </>
  );
}

function BubbleHeader({
  project, projectId, dock, onNew, onOpenPage, onDock, onFloat, onClose, router,
}: {
  project: string; projectId: string | null; dock: boolean;
  onNew: () => void; onOpenPage: () => void; onDock: () => void; onFloat: () => void; onClose: () => void;
  router: ReturnType<typeof useRouter>;
}) {
  const [picking, setPicking] = useState(false);
  const { data } = useSWR(picking && projectId ? ["chat-threads", projectId] : null, () => api.chatThreads(projectId!));
  const threads = data?.threads ?? [];

  return (
    <div className="ch-bub-head">
      <button type="button" className="ch-bub-thread-pick" onClick={() => setPicking((p) => !p)}>
        <Icon name="spark" size={13} />
        <div className="ch-bub-thread-t">{project}</div>
        <Icon name="chev" size={11} style={{ opacity: 0.6 }} />
      </button>
      <div className="ch-bub-actions">
        <button type="button" className="icon-btn" title="New thread" onClick={() => { onNew(); setPicking(false); }}>
          <Icon name="plus" size={13} />
        </button>
        <button type="button" className="icon-btn" title="Open as page" onClick={onOpenPage}>
          <Icon name="arrow" size={13} />
        </button>
        {dock ? (
          <button type="button" className="icon-btn" title="Float" onClick={onFloat}><Icon name="link" size={13} /></button>
        ) : (
          <button type="button" className="icon-btn" title="Dock to side" onClick={onDock}><Icon name="link" size={13} /></button>
        )}
        <button type="button" className="icon-btn" title="Close" aria-label="Close" onClick={onClose}><Icon name="x" size={13} /></button>
      </div>

      {picking && (
        <div className="ch-bub-thread-list">
          <div className="ask-threads-group" style={{ padding: "8px 12px 4px" }}>Threads</div>
          {threads.length ? threads.map((t) => (
            <button key={t.id} type="button" className="ask-thread" style={{ borderRadius: 0 }}
              onClick={() => { setPicking(false); onClose(); router.push("/ask"); }}>
              <div className="ask-thread-title">{t.title ?? "Untitled"}</div>
              <div className="ask-thread-sub mono">{t.updated_at ? new Date(t.updated_at).toLocaleDateString() : ""}</div>
            </button>
          )) : (
            <div className="muted" style={{ padding: "8px 12px 12px", fontSize: 12.5 }}>No saved threads yet.</div>
          )}
        </div>
      )}
    </div>
  );
}
