import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SubmitButton } from "../PreviewTools";
import { walk } from "../submitWalkthroughStore";
const m = vi.hoisted(() => ({ enabled: true }));
vi.mock("../DesignChatContext", () => ({ useDesignChat: () => ({ state: { publish: { open: 1, ok: true }, review: { enabled: m.enabled } }, setReviewOpen: vi.fn() }) }));
beforeEach(() => { walk.reset(); m.enabled = true; });
afterEach(cleanup);
const open = () => {
  const trigger = screen.getByRole("button", { name: "Submit for Review" });
  trigger.focus(); fireEvent.click(trigger);
  expect(screen.getByRole("dialog", { name: "Before You Submit for Review" })).toBeInTheDocument();
  expect(walk.get().open).toBe(false);
  return trigger;
};
it("opens on every tap and Continue alone starts the retained walkthrough", () => {
  render(<SubmitButton />); open();
  fireEvent.click(screen.getByRole("button", { name: "Return to Edit" }));
  expect(walk.get().open).toBe(false);
  open(); fireEvent.click(screen.getByRole("button", { name: "Continue to Review" }));
  expect(walk.get().open).toBe(true);
  expect(screen.queryByRole("dialog")).toBeNull();
  act(() => walk.update(w => ({ ...w, step: "links" })));
  act(() => walk.update(w => ({ ...w, step: "pages" })));
  expect(screen.queryByRole("dialog")).toBeNull();
});
it("Return to Edit preserves all existing decisions without opening review", () => {
  act(() => walk.update(w => ({ ...w, ticked: ["page:/"], checks: ["phone"] })));
  const before = walk.get();
  render(<SubmitButton />); open();
  fireEvent.click(screen.getByRole("button", { name: "Return to Edit" }));
  expect(walk.get()).toEqual(before);
});
it("Escape closes the introduction without starting review", () => {
  render(<SubmitButton />); open();
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(walk.get().open).toBe(false);
});
it("Publish with review off bypasses the review introduction", () => {
  m.enabled = false; render(<SubmitButton />);
  fireEvent.click(screen.getByRole("button", { name: "Publish" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(walk.get().open).toBe(true);
});