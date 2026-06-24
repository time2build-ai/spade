import {
  act,
  fireEvent,
  render as rtlRender,
  renderHook,
  screen,
} from "@testing-library/react";
import type { ReactElement } from "react";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { Project, Session } from "@/lib/types";
import type { UseProjectResult } from "@/lib/useProject";

// Render with a fresh SWR cache per call so `api.project` mocks don't leak
// across tests via SWR's module-level cache.
function render(ui: ReactElement) {
  return rtlRender(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      {ui}
    </SWRConfig>,
  );
}

// --- mocks ------------------------------------------------------------------
const apiSessions = vi.fn();
const apiPromptSession = vi.fn();
const apiSpawnOrchestrator = vi.fn();
const apiSession = vi.fn();
const apiAccounts = vi.fn();
vi.mock("@/lib/api", () => ({
  api: {
    sessions: () => apiSessions(),
    promptSession: (id: string, text: string) => apiPromptSession(id, text),
    spawnOrchestrator: (p: string, c: string) => apiSpawnOrchestrator(p, c),
    session: (id: string) => apiSession(id),
    accounts: () => apiAccounts(),
  },
}));

let mockUseProject: UseProjectResult;
vi.mock("@/lib/useProject", () => ({
  useProject: () => mockUseProject,
}));

import { AskDock } from "../AskDock";
import { useAskDock } from "@/lib/useAskDock";

const acme: Project = {
  id: "p1",
  name: "Acme",
  path: "/tmp/acme",
  account_strategy: "round_robin",
  model_ceiling: null,
  autopilot: 0,
  created_at: "2026-01-01",
};

function orchestratorSession(): Session {
  return {
    id: "orch-1",
    name: "orchestrator",
    alive: true,
    cmd: "claude",
    cwd: "/tmp/acme",
    role: "orchestrator",
    label: null,
    emoji: null,
    mode: "bypass",
    prep: "ready",
    prep_detail: null,
    task: null,
    order: null,
    model: null,
    mission: null,
    parent: null,
    reason: null,
    state: "idle",
    harness_state: null,
    has_menu: false,
    account_id: null,
    project_id: "p1",
  };
}

function projectResult(project: Project | null): UseProjectResult {
  return {
    projects: project ? [project] : [],
    project,
    setProject: vi.fn(),
    loading: false,
    error: undefined,
  };
}

afterEach(() => {
  vi.clearAllMocks();
  // Reset the shared dock store to closed between tests.
  const { result } = renderHook(() => useAskDock());
  act(() => result.current.setOpen(false));
});

describe("useAskDock (shared store)", () => {
  test("open state is shared across two consumers", () => {
    const one = renderHook(() => useAskDock()); // e.g. the topbar pill
    const two = renderHook(() => useAskDock()); // e.g. the global dock

    expect(one.result.current.open).toBe(false);
    expect(two.result.current.open).toBe(false);

    act(() => one.result.current.setOpen(true));
    expect(one.result.current.open).toBe(true);
    // The other consumer must reflect the change too (shared module store).
    expect(two.result.current.open).toBe(true);

    act(() => two.result.current.toggle());
    expect(one.result.current.open).toBe(false);
    expect(two.result.current.open).toBe(false);
  });
});

describe("AskDock", () => {
  beforeEach(() => {
    mockUseProject = projectResult(acme);
    // Default: at least one provider account exists, so the composer renders.
    apiAccounts.mockResolvedValue({ accounts: [{ id: "t2b" }] });
  });

  test("renders nothing when closed", () => {
    const { container } = render(<AskDock />);
    expect(container).toBeEmptyDOMElement();
  });

  test("open + no project shows the select-a-project hint, no composer", () => {
    mockUseProject = projectResult(null);
    const { result } = renderHook(() => useAskDock());
    act(() => result.current.setOpen(true));

    render(<AskDock />);
    expect(screen.getByText("Select a project to ask.")).toBeInTheDocument();
    expect(screen.queryByText("Send")).not.toBeInTheDocument();
  });

  test("open + project (with account) shows the composer", async () => {
    const { result } = renderHook(() => useAskDock());
    act(() => result.current.setOpen(true));

    render(<AskDock />);
    // The send button renders immediately; the composer is gated only on an
    // EMPTY pool, so a project with an account keeps the active composer.
    expect(await screen.findByLabelText("Send")).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("Ask the brain…"),
    ).toBeInTheDocument();
  });

  test("no provider accounts at all shows the empty-account state, no composer", async () => {
    apiAccounts.mockResolvedValue({ accounts: [] });

    const { result } = renderHook(() => useAskDock());
    act(() => result.current.setOpen(true));

    render(<AskDock />);

    expect(
      await screen.findByText(/No provider accounts/i),
    ).toBeInTheDocument();
    // The active composer / send control must NOT be present.
    expect(screen.queryByLabelText("Send")).not.toBeInTheDocument();
    expect(
      screen.queryByPlaceholderText("Ask the brain…"),
    ).not.toBeInTheDocument();
    // We must not have tried to spawn/prompt an orchestrator.
    expect(apiSpawnOrchestrator).not.toHaveBeenCalled();
    expect(apiPromptSession).not.toHaveBeenCalled();
  });

  test("sends a user message and renders the mocked brain reply", async () => {
    apiSessions.mockResolvedValue({ sessions: [orchestratorSession()] });
    apiPromptSession.mockResolvedValue({
      response: "Acme is on track.",
      state: "idle",
    });

    const { result } = renderHook(() => useAskDock());
    act(() => result.current.setOpen(true));

    render(<AskDock />);
    const input = (await screen.findByPlaceholderText(
      "Ask the brain…",
    )) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "How are we doing?" } });
    fireEvent.click(screen.getByLabelText("Send"));

    // user message renders immediately
    expect(await screen.findByText("How are we doing?")).toBeInTheDocument();
    // brain reply renders after the mocked prompt resolves
    expect(await screen.findByText("Acme is on track.")).toBeInTheDocument();

    // existing orchestrator was reused — no spawn path
    expect(apiSpawnOrchestrator).not.toHaveBeenCalled();
    expect(apiPromptSession).toHaveBeenCalledWith("orch-1", "How are we doing?");
  });

  test("renders a friendly error (not the raw 500) when the prompt fails", async () => {
    apiSessions.mockResolvedValue({ sessions: [orchestratorSession()] });
    apiPromptSession.mockRejectedValue(new Error("500 Internal Server Error"));

    const { result } = renderHook(() => useAskDock());
    act(() => result.current.setOpen(true));

    render(<AskDock />);
    const input = (await screen.findByPlaceholderText(
      "Ask the brain…",
    )) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "How are we doing?" } });
    fireEvent.click(screen.getByLabelText("Send"));

    // Friendly primary text shows as the main bubble text...
    const primary = await screen.findByText(/the orchestrator hit an error/i);
    expect(primary).toHaveClass("ask-msg-text");
    // ...and the raw "500 …" is only kept as a muted detail line, never the
    // primary bubble text.
    const raw = screen.getByText("500 Internal Server Error");
    expect(raw).toHaveClass("ask-msg-detail");
    expect(raw).not.toHaveClass("ask-msg-text");
  });
});
