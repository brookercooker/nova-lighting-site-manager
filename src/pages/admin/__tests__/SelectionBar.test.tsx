import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import SelectionBar from "../SelectionBar";
import { Button } from "@/components/ui/button";
afterEach(cleanup);
it("shows Edit mode selection actions at zero but prevents empty bulk actions", () => {
  const action = vi.fn();
  const { rerender } = render(<SelectionBar editing count={0} onClear={() => {}}><Button onClick={action}>Archive</Button><Button onClick={action}>Delete</Button></SelectionBar>);
  expect(screen.getByRole("button", { name: "Archive" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();
  rerender(<SelectionBar editing count={2} onClear={() => {}}><Button onClick={action}>Archive</Button></SelectionBar>);
  fireEvent.click(screen.getByRole("button", { name: "Archive" }));
  expect(action).toHaveBeenCalledOnce();
});
it("keeps non-Edit selection bars absent without a selection", () => {
  render(<SelectionBar count={0} onClear={() => {}} />);
  expect(screen.queryByRole("region", { name: "Selection Actions" })).toBeNull();
});