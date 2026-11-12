import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SubmitButton, SubmitConfirmDialog } from "../PreviewTools";
import { LinkCheckWindow, SubmitWalkthroughPanel } from "../SubmitWalkthrough";
import { walk, useWalk } from "../submitWalkthroughStore";

const m = vi.hoisted(() => ({ state: null as any, post: vi.fn(), refresh: vi.fn(), show: vi.fn(), review: vi.fn(), data: null as any }));
vi.mock("../DesignChatContext", () => ({ useDesignChat: () => ({ state: m.state, setReviewOpen: m.review, refreshSoon: m.refresh, showPreviewPath: m.show, selectPage: vi.fn() }) }));
vi.mock("../helper", () => ({ postToHelper: m.post }));
vi.mock("../useWalkthroughData", () => ({ useWalkthroughData: () => m.data }));
const page = (key: string, name: string) => ({ key: "page:" + key, page: { name, path: key }, how: "Changed by the builder" });
beforeEach(() => {
  vi.clearAllMocks();
  walk.reset();
  m.state = { busy: false, publish: { ok: true, open: 1 }, review: { enabled: true } };
  m.post.mockResolvedValue({ ok: true });
  m.data = { rows: [page("/a", "About")], pages: [], links: { status: "ok", groups: [], unread: 0, partial: false, truncated: false } };
});
afterEach(cleanup);

function PanelHost({ open = true, onOpenChange = () => {} }: { open?: boolean; onOpenChange?: (open: boolean) => void }) {
  const s = useWalk();
  return <><SubmitConfirmDialog open={open} onOpenChange={onOpenChange} />{s.open && <SubmitWalkthroughPanel onKeepEditing={() => { walk.keepEditing(); onOpenChange(false); }} />}<LinkCheckWindow /></>;
}
const dialog = () => screen.getByRole("region", { name: "Submit for Review Walkthrough" });
const viewAndTick = (name = "About") => {
  fireEvent.click(within(dialog()).getAllByRole("button", { name: "About" })[0]);
  // Open Page closes the walkthrough; the preview bar's Back to Review reopens it.
  act(() => walk.reopen("pages"));
  tickPageChecks(name);
  fireEvent.click(within(screen.getByRole("button", { name }).closest("li")!).getByRole("button", { name: "Approve" }));
};
/** Ticks the three "Check this page" items and confirms every changed link through the Check This Link window. */
const tickPageChecks = (name = "About") => {
  const row = () => within(screen.getByRole("button", { name }).closest("li")!);
  for (const t of ["Check how this page looks on a phone.", "Read the text that changed.", "Check the images and layout."]) fireEvent.click(row().getByRole("checkbox", { name: t }));
  while (row().queryAllByRole("button", { name: "Check This Link" }).length) {
    fireEvent.click(row().getAllByRole("button", { name: "Check This Link" })[0]);
    const win = within(screen.getByRole("dialog", { name: "Check This Link" }));
    fireEvent.click(win.getByRole("checkbox", { name: "I checked that this goes to the right place" }));
    fireEvent.click(win.getAllByRole("button", { name: "Close" })[0]);
  }
};
const tickManual = () => {
  for (const t of ["Check how it looks on a phone.", "Make sure nothing was changed by accident."])
    fireEvent.click(within(dialog()).getByRole("checkbox", { name: t }));
};

describe("Submit for Review walkthrough", () => {
  it.each(["pages", "links", "checklist"] as const)("Keep Editing is available on %s and preserves unchanged approvals", (step) => {
    m.data.links = { status: "failed" };
    const host = render(<PanelHost open onOpenChange={vi.fn()} />);
    viewAndTick();
    act(() => walk.update(s => ({ ...s, step })));
    fireEvent.click(within(dialog()).getByRole("button", { name: "Keep Editing" }));
    expect(screen.queryByRole("region", { name: "Submit for Review Walkthrough" })).toBeNull();
    expect(walk.get().ticked).toEqual(["page:/a"]);
    host.unmount();
    render(<PanelHost open />);
    expect(within(dialog()).getByRole("button", { name: "Approved" })).toHaveAttribute("aria-pressed", "true");
  });
  it("removes and flags approval on changed page data and requires reopening", () => {
    m.data.rows[0].fingerprint = "revision-1";
    const host = render(<PanelHost open />);
    viewAndTick();
    m.data = { ...m.data, rows: [{ ...m.data.rows[0], fingerprint: "revision-2" }] };
    host.rerender(<PanelHost open />);
    expect(dialog()).toHaveTextContent("Changed since you approved it");
    expect(within(dialog()).getByRole("button", { name: "Approve" })).toBeDisabled();
    expect(walk.get().viewed).toEqual([]);
    expect(walk.get().ticked).toEqual([]);
    expect(within(dialog()).getByRole("button", { name: "Next" })).toBeDisabled();
  });
  it("renders the new-tab affordance as an accessible icon link in the row title line", () => {
    render(<PanelHost open />);
    const link = within(dialog()).getByRole("link", { name: "Open in New Tab" });
    expect(link.textContent).toBe("");
    expect(link.querySelector("svg")).not.toBeNull();
    expect(link.closest("li")).not.toBeNull();
    expect(link.parentElement).toContainElement(within(dialog()).getByRole("button", { name: "About" }));
  });
  it("invalidates a link approval when its group changes and unticks the derived checklist", () => {
    const link = { key: "/a|/team", href: "/team", kind: "internal", label: "Team", requestIds: ["first"], status: null };
    m.data.links = { status: "ok", groups: [{ page: { name: "About", path: "/a" }, label: "About", links: [link] }] };
    const host = render(<PanelHost open />);
    viewAndTick();
    fireEvent.click(within(dialog()).getByRole("button", { name: "Next" }));
    // Confirmed in the Check This Link window, so the Links step already counts it.
    expect(within(dialog()).getByRole("button", { name: "Approved" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(within(dialog()).getByRole("button", { name: "Next" }));
    expect(within(dialog()).getByRole("checkbox", { name: "I checked the links that changed." })).toBeChecked();
    m.data = { ...m.data, links: { ...m.data.links, groups: [{ ...m.data.links.groups[0], links: [{ ...link, requestIds: ["first", "later"] }] }] } };
    host.rerender(<PanelHost open />);
    expect(within(dialog()).getByRole("checkbox", { name: /^Check the links that changed\./ })).not.toBeChecked();
    fireEvent.click(within(dialog()).getByRole("button", { name: "Back" }));
    expect(dialog()).toHaveTextContent("Changed since you approved it");
    expect(within(dialog()).getByRole("button", { name: "Approve" })).toBeDisabled();
  });
  it.each(["loading", "failed"])("does not allow advancing or submitting while the authoritative page list is %s", (status) => {
    m.data.rows = [];
    m.data.pagesStatus = status;
    render(<PanelHost open onOpenChange={vi.fn()} />);
    expect(within(dialog()).getByRole("button", { name: "Next" })).toBeDisabled();
    expect(m.post).not.toHaveBeenCalled();
  });
  it.each(["draft", "publish"])("blocks %s undo-pending even when review is otherwise allowed", (location) => {
    m.state.publish.willReview = true;
    if (location === "draft") m.state.draft = { gate: { status: "undo-pending", reason: "Wait for the rejected change to be undone." } };
    else Object.assign(m.state.publish, { status: "undo-pending", reason: "Wait for the rejected change to be undone." });
    render(<SubmitButton />);
    expect(screen.getByRole("button", { name: "Submit for Review" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("Wait for the rejected change to be undone.");
  });
  it("needs View Page before the page can be ticked", () => {
    render(<PanelHost open onOpenChange={vi.fn()} />);
    const box = within(dialog()).getByRole("button", { name: "Approve" });
    expect(box).toBeDisabled();
    expect(dialog()).toHaveTextContent("Open the page first");
    expect(within(dialog()).getByRole("button", { name: "Next" })).toBeDisabled();
    fireEvent.click(within(dialog()).getByRole("button", { name: "About" }));
    expect(m.show).toHaveBeenCalledWith("/a");
    expect(dialog()).toBeInTheDocument();
    expect(within(dialog()).getByRole("button", { name: "Approve" })).toBeDisabled();
    expect(dialog()).not.toHaveTextContent("Tick every check first");
    tickPageChecks();
    expect(within(dialog()).getByRole("button", { name: "Approve" })).toBeEnabled();
  });
  it("shows one gated Other site changes row that opens the home page", () => {
    m.data.rows = [{ key: "other", page: null, how: "2 changes that aren't tied to one page", count: 2 }];
    render(<PanelHost open onOpenChange={vi.fn()} />);
    expect(dialog()).toHaveTextContent("Other site changes");
    expect(dialog()).toHaveTextContent("0 of 1 page approved");
    expect(within(dialog()).getByRole("button", { name: "Approve" })).toBeDisabled();
    fireEvent.click(within(dialog()).getByRole("button", { name: "Open Site" }));
    expect(m.show).toHaveBeenCalledWith("/");
  });
  it("Open in New Tab also unlocks the tick, with a safe new-tab link", () => {
    render(<PanelHost open onOpenChange={vi.fn()} />);
    const link = within(dialog()).getByRole("link", { name: "Open in New Tab" });
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link.getAttribute("href")).toMatch(/\/a$/);
    fireEvent.click(link);
    tickPageChecks();
    expect(within(dialog()).getByRole("button", { name: "Approve" })).toBeEnabled();
  });
  it("never shows 0 of 0 and lets Next through when no pages changed", () => {
    m.data.rows = [];
    render(<PanelHost open onOpenChange={vi.fn()} />);
    expect(dialog()).not.toHaveTextContent("0 of 0");
    expect(dialog()).toHaveTextContent("No pages were changed in this draft.");
    expect(within(dialog()).getByRole("button", { name: "Next" })).toBeEnabled();
  });
  it("uses plural progress for multiple pages", () => {
    m.data.rows = [page("/a", "About"), page("/b", "Team")];
    render(<PanelHost open />);
    expect(dialog()).toHaveTextContent("0 of 2 pages approved");
    viewAndTick();
    expect(dialog()).toHaveTextContent("1 of 2 pages approved");
  });
  it("keeps Submit disabled until pages, links and the checklist are done, then submits once", async () => {
    m.data.links = { status: "ok", unread: 0, partial: false, truncated: false, groups: [{ page: { name: "About", path: "/a" }, label: "About", links: [{ key: "/a|mailto:x@y.z", href: "mailto:x@y.z", kind: "mail", label: null, requestIds: [], status: null }] }] };
    render(<PanelHost open onOpenChange={vi.fn()} />);
    expect(dialog()).toHaveTextContent("Step 1 of 3");
    viewAndTick();
    expect(dialog()).toHaveTextContent("1 of 1 page approved");
    fireEvent.click(within(dialog()).getByRole("button", { name: "Next" }));
    expect(dialog()).toHaveTextContent("Step 2 of 3");
    expect(dialog()).toHaveTextContent("1 of 1 links approved");
    fireEvent.click(within(dialog()).getByRole("button", { name: "Next" }));
    const submit = within(dialog()).getByRole("button", { name: "Submit for Review" });
    expect(submit).toBeDisabled();
    expect(dialog()).toHaveTextContent("2 checklist items left to tick");
    expect(within(dialog()).getByRole("checkbox", { name: "I checked the changed pages (About)." })).toBeChecked();
    expect(within(dialog()).getByRole("checkbox", { name: "I checked the links that changed." })).toBeChecked();
    tickManual();
    fireEvent.click(submit); fireEvent.click(submit);
    await vi.waitFor(() => expect(m.refresh).toHaveBeenCalledTimes(1));
    expect(m.post).toHaveBeenCalledExactlyOnceWith("/publish");
    expect(walk.get().ticked).toEqual([]);
  });
  it("flips checklist sentences from first person to past tense", () => {
    m.data.rows = [];
    render(<PanelHost open onOpenChange={vi.fn()} />);
    fireEvent.click(within(dialog()).getByRole("button", { name: "Next" }));
    const box = within(dialog()).getByRole("checkbox", { name: "Check how it looks on a phone." });
    fireEvent.click(box);
    expect(within(dialog()).getByRole("checkbox", { name: "I checked how it looks on a phone." })).toBeChecked();
    expect(dialog()).not.toHaveTextContent("wording and pictures");
  });
  it("skips the links step when no links changed and hides that checklist item", () => {
    render(<PanelHost open onOpenChange={vi.fn()} />);
    expect(dialog()).toHaveTextContent("Step 1 of 2");
    viewAndTick();
    fireEvent.click(within(dialog()).getByRole("button", { name: "Next" }));
    expect(dialog()).toHaveTextContent("Checklist and Submit");
    expect(within(dialog()).queryByText(/links I changed/)).toBeNull();
  });
  it("a failed link listing explains itself and does not block", () => {
    m.data.links = { status: "failed" };
    render(<PanelHost open onOpenChange={vi.fn()} />);
    viewAndTick();
    fireEvent.click(within(dialog()).getByRole("button", { name: "Next" }));
    expect(dialog()).toHaveTextContent("Links couldn't be listed right now.");
    fireEvent.click(within(dialog()).getByRole("button", { name: "Next" }));
    tickManual();
    expect(within(dialog()).getByRole("button", { name: "Submit for Review" })).toBeEnabled();
  });
  it("progress survives closing and reopening", () => {
    const { unmount } = render(<PanelHost open onOpenChange={vi.fn()} />);
    viewAndTick();
    unmount();
    render(<PanelHost open onOpenChange={vi.fn()} />);
    expect(within(dialog()).getByRole("button", { name: "Approved" })).toHaveAttribute("aria-pressed", "true");
  });
  it("lets a host keep the dialog when onRequestSubmit is passed", () => {
    const request = vi.fn();
    render(<SubmitButton onRequestSubmit={request} />);
    fireEvent.click(screen.getByRole("button", { name: "Submit for Review" }));
    expect(request).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it.each(["idle", "busy", "blocked", "unavailable"])("keeps submission disabled when %s", (reason) => {
    if (reason === "idle") m.state.publish.open = 0;
    if (reason === "busy") m.state.busy = true;
    if (reason === "blocked") m.state.publish.ok = false;
    if (reason === "unavailable") m.state = null;
    render(<SubmitButton />);
    expect(screen.getByRole("button", { name: "Submit for Review" })).toBeDisabled();
  });
  it("retains Publish when review is off, and says it goes live right away", () => {
    m.state.review.enabled = false; m.data.rows = [];
    render(<PanelHost open onOpenChange={() => {}} />);
    fireEvent.click(within(dialog()).getByRole("button", { name: "Next" }));
    expect(dialog()).toHaveTextContent("on the public site right away");
    expect(within(dialog()).getByRole("button", { name: "Publish" })).toBeInTheDocument();
  });
});
