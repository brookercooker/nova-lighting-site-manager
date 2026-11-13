import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultLibraryView, libraryViewKey, readLibraryView, useLibraryView } from "../libraryView";
import LibraryViewToggle from "../LibraryViewToggle";
import LibraryListRow from "../LibraryListRow";
import type { LabelScope } from "../useAllLabels";
vi.mock("../useAllLabels", () => ({ useLabelsForScope: () => ({ data: [] }) }));
afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); });
function Harness({ scope = "objects" }: { scope?: LabelScope }) {
  const [view, changeView] = useLibraryView(scope);
  const [selected, setSelected] = useState(false);
  return <><LibraryViewToggle value={view} onChange={changeView} /><LibraryListRow view={view} name="Site Footer" date="Today" thumbnail={<span>Preview</span>} badges={<span>Site-Wide</span>} menu={<span>Actions</span>} onOpen={() => {}} selection={<input type="checkbox" aria-label="Select Site Footer" checked={selected} onChange={e => setSelected(e.target.checked)} />} /></>;
}
describe("library views", () => {
  it.each([['objects','grid'],['images','grid'],['videos','grid'],['static','list'],['landing','list']] as const)("defaults %s to %s", (scope, view) => {
    expect(defaultLibraryView(scope)).toBe(view); expect(readLibraryView(scope)).toBe(view);
  });
  it("persists changes per library and restores on remount", () => {
    render(<Harness />); fireEvent.click(screen.getByRole("button", { name: "List view" }));
    expect(localStorage.getItem(libraryViewKey("objects"))).toBe("list");
    expect(readLibraryView("images")).toBe("grid");
    cleanup(); render(<Harness />); expect(screen.getByRole("button", { name: "List view" })).toHaveAttribute("aria-pressed", "true");
  });
  it("falls back on invalid or blocked storage and keeps the in-memory toggle", () => {
    localStorage.setItem(libraryViewKey("objects"), "invalid"); expect(readLibraryView("objects")).toBe("grid");
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    render(<Harness />); fireEvent.click(screen.getByRole("button", { name: "List view" }));
    expect(screen.getByRole("button", { name: "List view" })).toHaveAttribute("aria-pressed", "true");
  });
  it("keeps selection through switching views and permits toggling in each", () => {
    render(<Harness />); fireEvent.click(screen.getByRole("checkbox", { name: "Select Site Footer" }));
    fireEvent.click(screen.getByRole("button", { name: "List view" })); expect(screen.getByRole("checkbox")).toBeChecked();
    fireEvent.click(screen.getByRole("checkbox")); fireEvent.click(screen.getByRole("button", { name: "Grid view" })); expect(screen.getByRole("checkbox")).not.toBeChecked();
  });
  it.each(['list','grid'] as const)("opens through the same action and names options in %s", view => {
    const open = vi.fn();
    render(<LibraryListRow view={view} name="Site Footer" date="Today" thumbnail={<span />} badges={<span />} menu={<span />} onOpen={open} />);
    fireEvent.click(screen.getByRole("button", { name: "Open Site Footer" })); expect(open).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Options for Site Footer" })).toBeInTheDocument();
  });
});