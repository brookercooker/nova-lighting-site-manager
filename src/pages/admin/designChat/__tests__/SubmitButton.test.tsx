import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SubmitButton, SubmitConfirmDialog } from "../PreviewTools";
import { walk } from "../submitWalkthroughStore";

const m = vi.hoisted(() => ({ state: null as any, post: vi.fn(), refresh: vi.fn(), show: vi.fn(), data: null as any }));
vi.mock("../DesignChatContext", () => ({ useDesignChat: () => ({ state: m.state, refreshSoon: m.refresh, showPreviewPath: m.show, selectPage: vi.fn() }) }));
vi.mock("../helper", () => ({ postToHelper: m.post }));
vi.mock("../useWalkthroughData", () => ({ useWalkthroughData: () => m.data }));
const page = (key: string, name: string) => ({ key: "page:" + key, page: { name, path: key }, what: "Change " + name });
beforeEach(() => {
  vi.clearAllMocks();
  walk.reset();
  m.state = { busy: false, publish: { ok: true, open: 1 }, review: { enabled: true } };
  m.post.mockResolvedValue({ ok: true });
  m.data = { rows: [page("/a", "About")], pages: [], links: { status: "ok", groups: [], unread: 0, partial: false, truncated: false } };
});
afterEach(cleanup);

const dialog = () => screen.getByRole("dialog");
const viewAndTick = (name = "About") => {
  fireEvent.click(within(dialog()).getAllByRole("button", { name: "View Page" })[0]);
  // View Page closes the walkthrough; the preview bar's Back to Review reopens it.
  act(() => walk.reopen("pages"));
  fireEvent.click(within(screen.getByText(name).closest("li")!).getByRole("checkbox", { name: "Yup, looks good" }));
};
const tickManual = () => {
  for (const t of ["I will look at the page on a phone as well.", "I will make sure nothing I didn't mean to change was changed."])
    fireEvent.click(within(dialog()).getByRole("checkbox", { name: t }));
};

describe("Submit for Review walkthrough", () => {
  it.each(["draft", "publish"])("blocks %s undo-pending even when review is otherwise allowed", (location) => {
    m.state.publish.willReview = true;
    if (location === "draft") m.state.draft = { gate: { status: "undo-pending", reason: "Wait for the rejected change to be undone." } };
    else Object.assign(m.state.publish, { status: "undo-pending", reason: "Wait for the rejected change to be undone." });
    render(<SubmitButton />);
    expect(screen.getByRole("button", { name: "Submit for Review" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("Wait for the rejected change to be undone.");
  });
  it("needs View Page before the page can be ticked", () => {
    render(<SubmitConfirmDialog open onOpenChange={vi.fn()} />);
    const box = within(dialog()).getByRole("checkbox", { name: "Yup, looks good" });
    expect(box).toBeDisabled();
    expect(dialog()).toHaveTextContent("View the page first");
    expect(within(dialog()).getByRole("button", { name: "Next" })).toBeDisabled();
    fireEvent.click(within(dialog()).getByRole("button", { name: "View Page" }));
    expect(m.show).toHaveBeenCalledWith("/a");
    expect(screen.queryByRole("dialog")).toBeNull();
    act(() => walk.reopen("pages"));
    expect(within(dialog()).getByRole("checkbox", { name: "Yup, looks good" })).toBeEnabled();
  });
  it("rows without a page tick without the gate", () => {
    m.data.rows = [{ key: "req:1", page: null, what: "Change the shop hours" }];
    render(<SubmitConfirmDialog open onOpenChange={vi.fn()} />);
    expect(within(dialog()).getByText("Other Changes")).toBeInTheDocument();
    expect(within(dialog()).queryByRole("button", { name: "View Page" })).toBeNull();
    expect(within(dialog()).getByRole("checkbox", { name: "Yup, looks good" })).toBeEnabled();
  });
  it("keeps Submit disabled until pages, links and the checklist are done, then submits once", async () => {
    m.data.links = { status: "ok", unread: 0, partial: false, truncated: false, groups: [{ page: { name: "About", path: "/a" }, label: "About", links: [{ key: "/a|mailto:x@y.z", href: "mailto:x@y.z", kind: "mail", label: null, requestIds: [], status: null }] }] };
    render(<SubmitConfirmDialog open onOpenChange={vi.fn()} />);
    expect(dialog()).toHaveTextContent("Step 1 of 3");
    viewAndTick();
    expect(dialog()).toHaveTextContent("1 of 1 pages checked");
    fireEvent.click(within(dialog()).getByRole("button", { name: "Next" }));
    expect(dialog()).toHaveTextContent("Step 2 of 3");
    expect(within(dialog()).getByRole("button", { name: "Next" })).toBeDisabled();
    fireEvent.click(within(dialog()).getByRole("checkbox", { name: "Yup, this link works" }));
    fireEvent.click(within(dialog()).getByRole("button", { name: "Next" }));
    const submit = within(dialog()).getByRole("button", { name: "Submit for Review" });
    expect(submit).toBeDisabled();
    expect(dialog()).toHaveTextContent("2 checklist items left to tick");
    expect(within(dialog()).getByRole("checkbox", { name: "I checked the changed pages (About)." })).toBeChecked();
    expect(within(dialog()).getByRole("checkbox", { name: "I checked the links I changed." })).toBeChecked();
    tickManual();
    fireEvent.click(submit); fireEvent.click(submit);
    await vi.waitFor(() => expect(m.refresh).toHaveBeenCalledTimes(1));
    expect(m.post).toHaveBeenCalledExactlyOnceWith("/publish");
    expect(walk.get().ticked).toEqual([]);
  });
  it("flips checklist sentences from first person to past tense", () => {
    m.data.rows = [];
    render(<SubmitConfirmDialog open onOpenChange={vi.fn()} />);
    fireEvent.click(within(dialog()).getByRole("button", { name: "Next" }));
    const box = within(dialog()).getByRole("checkbox", { name: "I will look at the page on a phone as well." });
    fireEvent.click(box);
    expect(within(dialog()).getByRole("checkbox", { name: "I looked at the page on a phone as well." })).toBeChecked();
    expect(dialog()).not.toHaveTextContent("wording and pictures");
  });
  it("skips the links step when no links changed and hides that checklist item", () => {
    render(<SubmitConfirmDialog open onOpenChange={vi.fn()} />);
    expect(dialog()).toHaveTextContent("Step 1 of 2");
    viewAndTick();
    fireEvent.click(within(dialog()).getByRole("button", { name: "Next" }));
    expect(dialog()).toHaveTextContent("Checklist and Submit");
    expect(within(dialog()).queryByText(/links I changed/)).toBeNull();
  });
  it("a failed link listing explains itself and does not block", () => {
    m.data.links = { status: "failed" };
    render(<SubmitConfirmDialog open onOpenChange={vi.fn()} />);
    viewAndTick();
    fireEvent.click(within(dialog()).getByRole("button", { name: "Next" }));
    expect(dialog()).toHaveTextContent("Links couldn't be listed right now.");
    fireEvent.click(within(dialog()).getByRole("button", { name: "Next" }));
    tickManual();
    expect(within(dialog()).getByRole("button", { name: "Submit for Review" })).toBeEnabled();
  });
  it("progress survives closing and reopening", () => {
    const { unmount } = render(<SubmitConfirmDialog open onOpenChange={vi.fn()} />);
    viewAndTick();
    unmount();
    render(<SubmitConfirmDialog open onOpenChange={vi.fn()} />);
    expect(within(dialog()).getByRole("checkbox", { name: "Yup, looks good" })).toBeChecked();
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
    render(<SubmitConfirmDialog open onOpenChange={() => {}} />);
    fireEvent.click(within(dialog()).getByRole("button", { name: "Next" }));
    expect(dialog()).toHaveTextContent("on the public site right away");
    expect(within(dialog()).getByRole("button", { name: "Publish" })).toBeInTheDocument();
  });
});
