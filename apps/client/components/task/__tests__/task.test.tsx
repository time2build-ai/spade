import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { OriginCard } from "../OriginCard";
import { EvidenceSection } from "../EvidenceSection";
import { TimelineRail } from "../TimelineRail";
import { Relations } from "../Relations";
import type { BrainNode, Comment, LinkRel, TaskLink } from "@/lib/types";

function node(over: Partial<BrainNode>): BrainNode {
  return {
    id: "n1",
    project_id: "p1",
    type: "decision",
    label: "Node",
    detail: null,
    x: null,
    y: null,
    ...over,
  };
}

function comment(over: Partial<Comment>): Comment {
  return {
    id: "c1",
    author: "orchestrator",
    kind: "system",
    body: "Pipeline started",
    created_at: new Date().toISOString(),
    ...over,
  };
}

describe("EvidenceSection", () => {
  test("renders a row per node", () => {
    render(
      <EvidenceSection
        title="Decisions"
        type="decision"
        nodes={[
          node({ id: "a", label: "Adopt OAuth 2.1" }),
          node({ id: "b", label: "Use PKCE" }),
        ]}
      />,
    );
    expect(screen.getByText("Adopt OAuth 2.1")).toBeInTheDocument();
    expect(screen.getByText("Use PKCE")).toBeInTheDocument();
  });

  test("renders an honest empty state with no nodes", () => {
    render(<EvidenceSection title="Bugs" type="bug" nodes={[]} />);
    expect(screen.getByText("No linked bugs")).toBeInTheDocument();
  });
});

describe("OriginCard", () => {
  test("renders the quote as a serif-italic blockquote", () => {
    const { container } = render(
      <OriginCard
        task={{
          origin_quote: "Checkout is too slow on mobile",
          origin_source: "Priya Shah · Sprint Planning",
        }}
      />,
    );
    expect(
      screen.getByText(/Checkout is too slow on mobile/),
    ).toBeInTheDocument();
    const quote = container.querySelector("blockquote");
    expect(quote).not.toBeNull();
    // Serif + italic come from the .origin blockquote rule (font-family/style).
    expect(quote?.tagName.toLowerCase()).toBe("blockquote");
  });

  test("renders nothing when origin_quote is null", () => {
    const { container } = render(
      <OriginCard task={{ origin_quote: null, origin_source: null }} />,
    );
    expect(container.firstChild).toBeNull();
  });
});

describe("Relations", () => {
  let seq = 0;
  function link(from: string, to: string, rel: LinkRel): TaskLink {
    return { id: `l${seq++}`, from_task: from, to_task: to, rel, created_at: "2026-01-01" };
  }

  test("renders the right buckets + linked task ids for a mixed set", () => {
    render(
      <Relations
        taskId="SPD-005"
        links={[
          link("SPD-001", "SPD-005", "blocks"), // SPD-005 blocked by SPD-001
          link("SPD-005", "SPD-009", "blocks"), // SPD-005 blocks SPD-009
          link("SPD-002", "SPD-005", "subtask"), // parent SPD-002
          link("SPD-005", "SPD-007", "subtask"), // child SPD-007
          link("SPD-005", "SPD-008", "related"),
        ]}
      />,
    );
    expect(screen.getByText("Blocked by")).toBeInTheDocument();
    expect(screen.getByText("Blocks")).toBeInTheDocument();
    expect(screen.getByText("Parent")).toBeInTheDocument();
    expect(screen.getByText("Subtasks")).toBeInTheDocument();
    expect(screen.getByText("Related")).toBeInTheDocument();

    const upstream = screen.getByText("SPD-001");
    expect(upstream).toBeInTheDocument();
    expect(upstream.closest("a")).toHaveAttribute("href", "/task/SPD-001");
    expect(screen.getByText("SPD-009").closest("a")).toHaveAttribute("href", "/task/SPD-009");
    expect(screen.getByText("SPD-002")).toBeInTheDocument();
    expect(screen.getByText("SPD-007")).toBeInTheDocument();
    expect(screen.getByText("SPD-008")).toBeInTheDocument();
  });

  test("renders an honest empty state with no links", () => {
    render(<Relations taskId="SPD-005" links={[]} />);
    expect(screen.getByText("No dependencies")).toBeInTheDocument();
  });
});

describe("TimelineRail", () => {
  test("renders comment authors and bodies", () => {
    render(
      <TimelineRail
        comments={[
          comment({ id: "1", author: "orchestrator", body: "Pipeline started" }),
          comment({ id: "2", author: "Claude", body: "Building feature" }),
        ]}
      />,
    );
    expect(screen.getByText("orchestrator")).toBeInTheDocument();
    expect(screen.getByText("Pipeline started")).toBeInTheDocument();
    expect(screen.getByText("Claude")).toBeInTheDocument();
    expect(screen.getByText("Building feature")).toBeInTheDocument();
  });

  test("renders an empty state with no comments", () => {
    render(<TimelineRail comments={[]} />);
    expect(screen.getByText("No activity yet")).toBeInTheDocument();
  });
});
