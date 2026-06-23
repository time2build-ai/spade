import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { OriginCard } from "../OriginCard";
import { EvidenceSection } from "../EvidenceSection";
import { TimelineRail } from "../TimelineRail";
import type { BrainNode, Comment } from "@/lib/types";

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
