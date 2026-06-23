import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import {
  Card,
  Btn,
  IconBtn,
  Chip,
  Priority,
  Avatar,
  Kbd,
  TogglePill,
  Subtab,
  PageHead,
} from "../index";

describe("Card", () => {
  test("renders children inside a bordered surface", () => {
    const { container } = render(<Card>content</Card>);
    const el = container.querySelector(".card");
    expect(el).toBeInTheDocument();
    expect(el).toHaveTextContent("content");
  });
});

describe("Btn", () => {
  test("renders children", () => {
    render(<Btn>Save</Btn>);
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });

  test("applies primary marker class when variant=primary", () => {
    const { container } = render(<Btn variant="primary">Go</Btn>);
    const btn = container.querySelector("button");
    expect(btn).toHaveClass("btn", "primary");
  });

  test("applies ghost and size markers", () => {
    const { container } = render(
      <Btn variant="ghost" size="xs">
        x
      </Btn>,
    );
    expect(container.querySelector("button")).toHaveClass("ghost", "xs");
  });
});

describe("IconBtn", () => {
  test("renders an icon svg", () => {
    const { container } = render(<IconBtn icon="plus" aria-label="add" />);
    expect(container.querySelector("button.icon-btn")).toBeInTheDocument();
    expect(container.querySelector("svg")).toBeInTheDocument();
  });
});

describe("Chip", () => {
  test("renders label and carries the decision marker", () => {
    const { container } = render(<Chip type="decision">ADR-031</Chip>);
    const chip = container.querySelector(".chip");
    expect(chip).toHaveClass("decision");
    expect(chip).toHaveTextContent("ADR-031");
    expect(chip?.querySelector(".d")).toBeInTheDocument();
  });

  test("without a type renders a neutral chip and no variant class", () => {
    const { container } = render(<Chip>plain</Chip>);
    const chip = container.querySelector(".chip");
    expect(chip).toHaveTextContent("plain");
    expect(chip?.className.trim()).toBe("chip");
  });
});

describe("Priority", () => {
  test("level=0 renders the p0 marker", () => {
    const { container } = render(<Priority level={0} />);
    expect(container.querySelector(".priority")).toHaveClass("p0");
  });

  test("out-of-range level clamps to p3", () => {
    const { container } = render(<Priority level={5} />);
    expect(container.querySelector(".priority")).toHaveClass("p3");
  });
});

describe("Avatar", () => {
  test("ai variant carries the ai marker", () => {
    const { container } = render(<Avatar ai>AI</Avatar>);
    expect(container.querySelector(".avatar")).toHaveClass("ai");
  });
});

describe("Kbd", () => {
  test("renders keycap text", () => {
    const { container } = render(<Kbd>⌘K</Kbd>);
    const el = container.querySelector(".kbd");
    expect(el).toBeInTheDocument();
    expect(el).toHaveTextContent("⌘K");
  });
});

describe("TogglePill", () => {
  test("reflects on state and fires onChange with next value", () => {
    const onChange = vi.fn();
    const { container } = render(<TogglePill on onChange={onChange} />);
    const sw = container.querySelector(".toggle-pill")!;
    expect(sw).toHaveClass("on");
    expect(sw).toHaveAttribute("data-state", "on");
    expect(sw).toHaveAttribute("aria-checked", "true");
    fireEvent.click(sw);
    expect(onChange).toHaveBeenCalledWith(false);
  });
});

describe("Subtab", () => {
  test("active gets the active marker", () => {
    const { container } = render(<Subtab active>Overview</Subtab>);
    expect(container.querySelector(".subtab")).toHaveClass("active");
  });
});

describe("PageHead", () => {
  test("renders title and actions", () => {
    render(<PageHead title="Backlog" actions={<button>New</button>} />);
    expect(
      screen.getByRole("heading", { name: "Backlog" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New" })).toBeInTheDocument();
  });
});
