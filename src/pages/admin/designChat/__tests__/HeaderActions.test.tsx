import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import HeaderActions from "../HeaderActions";
const m = vi.hoisted(() => ({ state: null as any, editing: false, reviewOpen: false, setReviewOpen: vi.fn(), post: vi.fn(), refresh: vi.fn(), copy: vi.fn() }));
vi.mock("../DesignChatContext", () => ({ useDesignChat: () => ({ state: m.state, editing: m.editing, refreshSoon: m.refresh, previewLocation: { path: "/draft" }, workingPage: null, reviewOpen: m.reviewOpen, setReviewOpen: m.setReviewOpen }) }));
vi.mock("../helper", () => ({ postToHelper: m.post }));
beforeEach(() => {
  vi.clearAllMocks(); m.editing = false;
  m.state = { busy: false, history: [{ role: "user", text: "Add an image" }], publish: { ok: true, open: 2 } };
  m.post.mockResolvedValue({ ok: true }); m.copy.mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: m.copy } });
});
afterEach(cleanup);
describe("Left-header actions", () => {
  it("shares the published net count rather than inflated request totals", () => {
    m.state.publish.open = 14;
    m.state.draft = { requests: [], netChanges: { baseline: "published", items: [
      { id: "footer", summary: "Footer link", changed: false, requestIds: [] },
      ...["text", "picture", "chat"].map(id => ({ id, summary: id, changed: true, requestIds: [] })),
    ] } };
    render(<HeaderActions />);
    expect(screen.getByRole("button", { name: "Review Status: 3 Waiting" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Review Status: 14 Waiting" })).toBeNull();
  });
  it("expands the collapsed column before opening Review Status", () => {
    m.reviewOpen = false; const expand = vi.fn(); render(<HeaderActions onExpand={expand} />);
    fireEvent.click(screen.getByRole("button", { name: "Review Status: 2 Waiting" }));
    expect(expand).toHaveBeenCalledOnce(); expect(m.setReviewOpen).toHaveBeenCalledWith(true);
    expect(expand.mock.invocationCallOrder[0]).toBeLessThan(m.setReviewOpen.mock.invocationCallOrder[0]);
  });
  it("toggles the review view from the count button", () => {
    const view = render(<HeaderActions />);
    fireEvent.click(screen.getByRole("button", { name: "Review Status: 2 Waiting" }));
    expect(m.setReviewOpen).toHaveBeenLastCalledWith(true);
    m.reviewOpen = true; view.rerender(<HeaderActions />);
    fireEvent.click(screen.getByRole("button", { name: "Review Status: 2 Waiting" }));
    expect(m.setReviewOpen).toHaveBeenLastCalledWith(false);
    m.reviewOpen = false;
  });
  it("is disabled during Manual Edit Mode", () => {
    m.editing = true; render(<HeaderActions />);
    expect(screen.getByRole("button", { name: "Review Status: 2 Waiting" })).toBeDisabled();
  });
  it("leaves Status to the Tools menu when hideStatus is set", () => {
    render(<HeaderActions hideStatus />);
    expect(screen.queryByRole("button", { name: /Review Status/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Help" })).toBeInTheDocument();
  });
  it("has no undo button", () => {
    render(<HeaderActions />);
    expect(screen.queryByRole("button", { name: /undo/i })).toBeNull();
  });
  it("copies the current page and last recorded action for a problem report", async () => {
    render(<HeaderActions />);
    fireEvent.click(screen.getByRole("button", { name: "Help" }));
    fireEvent.click(screen.getByRole("button", { name: "Copy Problem Summary" }));
    await waitFor(() => expect(m.copy).toHaveBeenCalledOnce());
    expect(m.copy.mock.calls[0][0]).toContain("Page: /draft");
    expect(m.copy.mock.calls[0][0]).toContain("Last action: Add an image");
  });
});