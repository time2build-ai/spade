import { render } from "@testing-library/react";
import { Icon } from "../Icon";
import { describe, expect, test } from "vitest";

test("renders an svg for a known icon", () => {
  const { container } = render(<Icon name="brain" />);
  const svg = container.querySelector("svg");
  expect(svg).toBeInTheDocument();
  expect(svg).toHaveAttribute("stroke-width", "1.6");
  expect(
    svg?.querySelector("path, circle, line, rect, polyline, polygon"),
  ).toBeInTheDocument();
});

test("respects size prop", () => {
  const { container } = render(<Icon name="cog" size={20} />);
  expect(container.querySelector("svg")).toHaveAttribute("width", "20");
});
