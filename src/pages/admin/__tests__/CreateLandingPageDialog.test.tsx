import { beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import CreateLandingPageDialog from "../CreateLandingPageDialog";

const insert = vi.hoisted(() => vi.fn(async () => ({ error: null })));
vi.mock("@/prototype/client", () => ({ supabase: { from: () => ({ select: async () => ({ data: [] }), insert }) } }));
vi.mock("../designChat/contentSync", () => ({ notifyContentEdited: vi.fn() }));
beforeEach(() => { cleanup(); insert.mockClear(); });
it("blocks creating a December 10 campaign ending December 1, including the save handler", async () => {
  const { container } = render(<CreateLandingPageDialog open onOpenChange={vi.fn()} />);
  fireEvent.change(screen.getByPlaceholderText("e.g. Summer Sale 2026"), { target: { value: "Winter Campaign" } });
  fireEvent.click(screen.getByRole("checkbox"));
  const dates = document.querySelectorAll('input[type="date"]');
  fireEvent.change(dates[0], { target: { value: "2026-12-10" } });
  fireEvent.change(dates[1], { target: { value: "2026-12-01" } });
  const create = screen.getByRole("button", { name: "Create Landing Page" });
  expect(create).toBeDisabled();
  fireEvent.click(create);
  expect(insert).not.toHaveBeenCalled();
  fireEvent.change(dates[1], { target: { value: "2026-12-11" } });
  expect(create).toBeEnabled();
});