import { render, screen, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { Project } from "@/lib/types";
import type { UseProjectResult } from "@/lib/useProject";
import { Sidebar } from "../Sidebar";
import { ProjectSwitcher } from "../ProjectSwitcher";

// Mock Next routing: <Link> renders a plain anchor; usePathname is controllable.
let mockPathname = "/backlog";
vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
}));
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

// Controllable useProject mock.
const setProject = vi.fn();
let mockUseProject: UseProjectResult;
vi.mock("@/lib/useProject", () => ({
  useProject: () => mockUseProject,
}));

const acme: Project = {
  id: "p_acme",
  name: "Acme Storefront",
  path: "/tmp/acme",
  account_strategy: "round_robin",
  model_ceiling: null,
  autopilot: 0,
  created_at: "2026-01-01",
};

const mobile: Project = { ...acme, id: "p_mobile", name: "Mobile App" };

function withProjects(project: Project | null, projects: Project[]): UseProjectResult {
  return { project, projects, setProject, loading: false, error: undefined };
}

afterEach(() => {
  vi.clearAllMocks();
  mockPathname = "/backlog";
});

describe("Sidebar", () => {
  test("renders the Backlog link to /backlog and group headers", () => {
    mockUseProject = withProjects(acme, [acme, mobile]);
    render(<Sidebar />);

    const backlog = screen.getByRole("link", { name: /Backlog/ });
    expect(backlog).toHaveAttribute("href", "/backlog");

    for (const header of ["Project", "Plan", "Execution", "Inputs", "System"]) {
      expect(screen.getByText(header)).toBeInTheDocument();
    }
  });

  test("marks the active item via pathname", () => {
    mockUseProject = withProjects(acme, [acme]);
    render(<Sidebar />);
    expect(screen.getByRole("link", { name: /Backlog/ })).toHaveClass("active");
  });
});

describe("ProjectSwitcher", () => {
  test("shows placeholder when no project is selected", () => {
    mockUseProject = withProjects(null, []);
    render(<ProjectSwitcher />);
    expect(screen.getByText("Select a project")).toBeInTheDocument();
  });

  test("shows the project name and opens a dropdown listing projects", () => {
    mockUseProject = withProjects(acme, [acme, mobile]);
    render(<ProjectSwitcher />);

    expect(screen.getByText("Acme Storefront")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { expanded: false }));

    expect(screen.getByText("Switch project")).toBeInTheDocument();
    expect(screen.getByText("Mobile App")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Mobile App"));
    expect(setProject).toHaveBeenCalledWith("p_mobile");
  });
});
