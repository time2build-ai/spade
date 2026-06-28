import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { AccountCard } from "../AccountCard";
import { AgentCard } from "../AgentCard";
import type { Account, Session } from "@/lib/types";

function account(over: Partial<Account> = {}): Account {
  return {
    id: "acc-1",
    label: "Primary",
    color: null,
    provider: "claude-code",
    config_dir: "/home/u/.claude/primary",
    is_default: 0,
    created_at: "2026-01-01",
    ...over,
  };
}

function session(over: Partial<Session> = {}): Session {
  return {
    id: "s1",
    name: "agent-1",
    alive: true,
    cmd: "claude",
    cwd: "/work",
    role: "developer",
    label: null,
    emoji: null,
    mode: null,
    prep: "ready",
    prep_detail: null,
    task: null,
    order: null,
    model: "opus",
    mission: null,
    parent: null,
    reason: null,
    state: "running",
    harness_state: null,
    has_menu: false,
    account_id: null,
    project_id: null,
    ...over,
  };
}

describe("AccountCard", () => {
  test("renders label, provider glyph avatar, role pill + model·plan sub", () => {
    const { container } = render(<AccountCard account={account()} />);
    expect(screen.getByText("Primary")).toBeTruthy();
    expect(container.querySelector('[data-testid="acct-glyph"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="acct-role"]')).toBeTruthy();
    expect(container.querySelector(".acct-sub")?.textContent).toContain("·");
  });

  test("defaults to the idle state when not in use", () => {
    const { container } = render(<AccountCard account={account()} />);
    expect(container.querySelector('.acct-state[data-state="idle"]')).toBeTruthy();
  });

  test("shows the in-use state when inUse", () => {
    const { container } = render(<AccountCard account={account()} inUse />);
    expect(container.querySelector('.acct-state[data-state="running"]')).toBeTruthy();
  });

  test("shows the default badge when is_default === 1", () => {
    render(<AccountCard account={account({ is_default: 1 })} />);
    expect(screen.getByText("default")).toBeTruthy();
  });

  test("hides the default badge when is_default === 0", () => {
    render(<AccountCard account={account({ is_default: 0 })} />);
    expect(screen.queryByText("default")).toBeNull();
  });

  test("renders a usage meter (seeded)", () => {
    const { container } = render(<AccountCard account={account()} />);
    expect(container.querySelector('[data-testid="acct-meter"] .fill')).toBeTruthy();
  });
});

describe("AgentCard", () => {
  test("renders name, role, model, and a status pill", () => {
    const { container } = render(
      <AgentCard session={session({ name: "dev-bot", role: "developer", model: "opus" })} />,
    );
    expect(screen.getByText("dev-bot")).toBeTruthy();
    expect(screen.getByText(/developer/)).toBeTruthy();
    expect(screen.getByText(/opus/)).toBeTruthy();
    expect(container.querySelector(".ap-state-pill")).toBeTruthy();
  });

  test("omits null meta (e.g. null task) without crashing", () => {
    const { container } = render(
      <AgentCard session={session({ task: null, mission: null, account_id: null })} />,
    );
    // No meta rows render when all meta is null.
    expect(container.querySelectorAll(".ap-meta-row").length).toBe(0);
  });

  test("renders non-null meta rows", () => {
    render(
      <AgentCard session={session({ task: "SPD-1", account_id: "acc-9" })} />,
    );
    expect(screen.getByText("SPD-1")).toBeTruthy();
    expect(screen.getByText("acc-9")).toBeTruthy();
  });
});
