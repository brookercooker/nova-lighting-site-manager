import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import LibraryFieldDialog from "../LibraryFieldDialog";
afterEach(cleanup);
it("saves typed metadata through its existing callback", async () => {
  const save = vi.fn(async () => {}), close = vi.fn();
  render(<LibraryFieldDialog title="Edit Description" value="Original" multiline onSave={save} onClose={close} />);
  fireEvent.change(screen.getByRole("textbox"), {target:{value:"New description"}});
  fireEvent.click(screen.getByRole("button",{name:"Save"}));
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(save).toHaveBeenCalledWith("New description");
});
it("retains unsaved input when saving fails and cancels without writing", async () => {
  const save = vi.fn(async () => {throw new Error("Cannot save");}), close = vi.fn();
  render(<LibraryFieldDialog title="Rename" value="Original" onSave={save} onClose={close} />);
  fireEvent.change(screen.getByRole("textbox"), {target:{value:"New name"}});
  fireEvent.click(screen.getByRole("button",{name:"Save"}));
  await screen.findByRole("alert");
  expect(close).not.toHaveBeenCalled(); expect(screen.getByRole("textbox")).toHaveValue("New name");
  fireEvent.click(screen.getByRole("button",{name:"Cancel"}));
  expect(save).toHaveBeenCalledTimes(1); expect(close).toHaveBeenCalledOnce();
});