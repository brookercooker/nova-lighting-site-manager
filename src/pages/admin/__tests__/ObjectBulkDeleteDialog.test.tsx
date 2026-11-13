import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import ObjectBulkDeleteDialog from "../ObjectBulkDeleteDialog";
import type { ObjectRegistryRow } from "../useObjectRegistry";
afterEach(cleanup);
const object = (id: string, site_wide = false) => ({ id, name: id, site_wide, component_key: null } as ObjectRegistryRow);
it("requires confirmation before deleting two objects with the existing mutation", async () => {
  const remove = vi.fn().mockResolvedValue(undefined), onDeleted = vi.fn(), onClose = vi.fn();
  render(<ObjectBulkDeleteDialog targets={[object("A"), object("B")]} remove={remove} onDeleted={onDeleted} onClose={onClose} usagesFor={() => []} />);
  expect(remove).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  expect(remove.mock.calls).toEqual([["A"], ["B"]]);
  expect(onDeleted.mock.calls).toEqual([["A"], ["B"]]);
});
it("never deletes a selection containing a site-wide object", () => {
  const remove = vi.fn();
  render(<ObjectBulkDeleteDialog targets={[object("A"), object("Site Footer", true)]} remove={remove} onDeleted={()=>{}} onClose={()=>{}} usagesFor={() => []} />);
  expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled();
  expect(remove).not.toHaveBeenCalled();
});
it("cancel preserves all selected objects", () => {
  const remove = vi.fn(), close = vi.fn();
  render(<ObjectBulkDeleteDialog targets={[object("A")]} remove={remove} onDeleted={()=>{}} onClose={close} usagesFor={() => []} />);
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(close).toHaveBeenCalledOnce(); expect(remove).not.toHaveBeenCalled();
});
it("retains the existing in-use warning without silently blocking ordinary used objects", () => {
  render(<ObjectBulkDeleteDialog targets={[object("About Us")]} remove={vi.fn()} onDeleted={()=>{}} onClose={()=>{}} usagesFor={() => [{ name: "Homepage", path: "/", type: "static" }]} />);
  expect(screen.getByRole("alert")).toHaveTextContent("Homepage");
  expect(screen.getByRole("button", { name: "Delete" })).toBeEnabled();
});
it("stops on a failed single-item mutation and retains the confirmation", async () => {
  const remove = vi.fn().mockRejectedValue(new Error("Delete failed")), close = vi.fn(), onDeleted = vi.fn();
  render(<ObjectBulkDeleteDialog targets={[object("A"), object("B")]} remove={remove} onDeleted={onDeleted} onClose={close} usagesFor={() => []} />);
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled());
  expect(remove.mock.calls).toEqual([["A"]]);
  expect(onDeleted).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled();
});