import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ resolve: vi.fn(), save: vi.fn(), reset: vi.fn(), refreshRemoved: vi.fn(), notify: vi.fn(), fallback: vi.fn(), phone: false }));
vi.mock("../reviewLinkSave", () => ({ resolveReviewLink: m.resolve, saveReviewLink: m.save, resetReviewLink: m.reset, refreshRemovedReviewLink: m.refreshRemoved, FIND_LINK_ERROR: "We couldn't pin down which link this is. Use Open in Manual Edit to change it." }));
vi.mock("../DesignChatContext", () => ({ useDesignChat: () => ({ preview: null }) }));
vi.mock("../useManagerLayout", () => ({ useManagerLayout: () => ({ phone: m.phone }) }));
vi.mock("../linkFix", () => ({ useChangeLink: () => m.fallback }));
vi.mock("../contentSync", () => ({ notifyContentEdited: m.notify }));
import { ReviewLinkEditor } from "../ReviewLinkEditor";
import { walk } from "../submitWalkthroughStore";
const link = { key: "/|/contact", href: "/contact", kind: "internal" as const, label: "Consultation", requestIds: [], status: null };
const group = { page: { name: "Homepage", path: "/" }, label: "Homepage", links: [link] };
const pages = [{ name: "Inspiration Gallery", path: "/gallery", build_status: "ready" }];
beforeEach(() => {
  vi.clearAllMocks(); walk.reset(); m.phone = false;
  m.resolve.mockResolvedValue({ href: "/contact", blank: true, element: { key: "0.5.0.1", scope: "page" } }); m.save.mockResolvedValue(["Homepage: changed link to /gallery"]);
  walk.update(s => ({ ...s, open: true, ticked: ["page:/"], approvals: { "page:/": "p1" }, linkTicked: ["/|/team"], linkApprovals: { "/|/team": "l1" } }));
  walk.editLink({ link, group, rows: [], fingerprint: "own" });
});
afterEach(cleanup);
it("prefills current destination and target, suggests friendly pages and saves without a mode switch", async () => {
  render(<ReviewLinkEditor pages={pages} />);
  await waitFor(() => expect(screen.getByRole("switch", { name: "Open in New Tab" })).toBeChecked());
  const field = screen.getByLabelText("New Destination");
  expect(field).toHaveValue("/contact");
  fireEvent.change(field, { target: { value: "Inspiration" } });
  fireEvent.click(screen.getByRole("button", { name: "Inspiration Gallery" }));
  expect(field).toHaveValue("/gallery");
  fireEvent.click(screen.getByRole("button", { name: "Save New Link" }));
  await waitFor(() => expect(m.notify).toHaveBeenCalled());
  expect(m.save).toHaveBeenCalledWith(expect.anything(), "/gallery", true);
  expect(walk.get()).toMatchObject({ open: true, step: "links", fix: null, reviewEdit: null, ticked: ["page:/"], linkTicked: ["/|/team"], linkReplaced: { [link.key]: "own" }, savedReviewLinks: [{ path: "/", link: { href: "/gallery", key: "/|/gallery" } }] });
  expect(m.fallback).not.toHaveBeenCalled();
  act(() => walk.reconcile({ "page:/": "p2" }, { "/|/team": "l1", "/|/contact": "old", "/|/gallery": "new" }, { "/|/contact": "own", "/|/gallery": "new" }));
  expect(walk.get().ticked).toEqual(["page:/"]);
  expect(walk.get().linkTicked).toEqual(["/|/team"]);
  expect(walk.get().linkReplaced[link.key]).toBe("own");
});
it("validation and save errors retain the typed destination", async () => {
  render(<ReviewLinkEditor pages={pages} />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Save New Link" })).toBeEnabled());
  const field = screen.getByLabelText("New Destination");
  fireEvent.change(field, { target: { value: "http://bad.example" } });
  fireEvent.click(screen.getByRole("button", { name: "Save New Link" }));
  expect(screen.getByRole("button", { name: "Save New Link" })).toBeDisabled(); expect(m.save).not.toHaveBeenCalled();
  expect(field).toHaveValue("http://bad.example");
  m.save.mockRejectedValue(new Error("Your new link couldn't be saved. Try again."));
  fireEvent.change(field, { target: { value: "/gallery" } });
  fireEvent.click(screen.getByRole("button", { name: "Save New Link" }));
  await screen.findByText("Your new link couldn't be saved. Try again.");
  expect(field).toHaveValue("/gallery"); expect(walk.get().reviewEdit).not.toBeNull();
});
it("pre-existing saved/preview mismatch offers Manual without a changed-since-open loop", async () => {
  m.resolve.mockRejectedValue(new Error("The saved link and the page don't match yet. Use Open in Manual Edit to change it."));
  render(<ReviewLinkEditor pages={pages} />);
  await screen.findByRole("button", { name: "Open in Manual Edit" });
  expect(screen.queryByRole("button", { name: "Save New Link" })).toBeNull();
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByText(/saved link and the page don't match yet/)).toHaveAttribute("role", "status");
});
it("resolution failure offers only the existing Manual fallback, including shared-page selection", async () => {
  m.resolve.mockRejectedValue(new Error("We couldn't find this link on the page"));
  const rows = [{ key: "page:/about", page: { name: "About", path: "/about" }, how: "x" }];
  walk.editLink({ link, group: { ...group, page: null }, rows, fingerprint: "own" });
  render(<ReviewLinkEditor pages={pages} />);
  await screen.findByRole("button", { name: "Open in Manual Edit" });
  expect(screen.queryByRole("button", { name: "Save New Link" })).toBeNull();
  expect(screen.queryByRole("alert")).toBeNull();
  expect(m.resolve).toHaveBeenCalledWith("/about", "/contact", "Consultation", undefined, { elementKey: undefined, scope: undefined });
  fireEvent.click(screen.getByRole("button", { name: "Open in Manual Edit" }));
  expect(m.fallback).toHaveBeenCalledWith(link, expect.objectContaining({ page: null }), rows, "own");
  expect(m.save).not.toHaveBeenCalled();
});
it("phone uses a bottom sheet and Cancel discards local input without changing approvals", async () => {
  m.phone = true; render(<ReviewLinkEditor pages={pages} />);
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole("button", { name: "Save New Link" })).toBeEnabled());
  fireEvent.change(screen.getByLabelText("New Destination"), { target: { value: "/gallery" } });
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(walk.get().reviewEdit).toBeNull(); expect(walk.get().linkTicked).toEqual(["/|/team"]); expect(m.save).not.toHaveBeenCalled();
});
it("editing a confirmed link replaces the old confirmation and leaves the new link unconfirmed", async () => {
  walk.update(s => ({ ...s, linkTicked: [...s.linkTicked, link.key], linkApprovals: { ...s.linkApprovals, [link.key]: "confirmed" } }));
  render(<ReviewLinkEditor pages={pages} />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Save New Link" })).toBeEnabled());
  fireEvent.change(screen.getByLabelText("New Destination"), { target: { value: "/gallery" } });
  fireEvent.click(screen.getByRole("button", { name: "Save New Link" }));
  await waitFor(() => expect(m.notify).toHaveBeenCalled());
  expect(walk.get().linkReplaced[link.key]).toBe("own");
  expect(walk.get().linkTicked).not.toContain(link.key);
  expect(walk.get().linkTicked).not.toContain("/|/gallery");
});
it("legacy wrong state is safely dropped without changing current approvals", () => {
  walk.update(s => ({ ...s, linkWrong: { [link.key]: "legacy" } }));
  expect(walk.get()).not.toHaveProperty("linkWrong");
  expect(walk.get().linkTicked).toEqual(["/|/team"]);
});
it("retains the visible footer wording after saving a destination", async () => {
  m.resolve.mockResolvedValue({ href: "/contact", blank: false, element: { key: "0.1", scope: "object:footer", label: "Ideas & Advice" } });
  walk.editLink({ link, group: { ...group, shared: { id: "footer", name: "Site Footer", pages: [{ name: "Homepage", path: "/" }] } }, rows: [], fingerprint: "own" });
  render(<ReviewLinkEditor pages={pages} />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Save New Link" })).toBeEnabled());
  fireEvent.change(screen.getByLabelText("New Destination"), { target: { value: "/gallery" } });
  fireEvent.click(screen.getByRole("button", { name: "Save New Link" }));
  await waitFor(() => expect(walk.get().savedReviewLinks[0]?.link.label).toBe("Ideas & Advice"));
});

it.each(["javascript:alert(1)", "//host", "plain words", ""])("blocks invalid destination %s during typing", async value => {
  render(<ReviewLinkEditor pages={pages} />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Save New Link" })).toBeEnabled());
  fireEvent.change(screen.getByLabelText("New Destination"), { target: { value } });
  expect(screen.getByRole("button", { name: "Save New Link" })).toBeDisabled();
  expect(m.save).not.toHaveBeenCalled();
});
it("allows a syntactically valid future page without saving automatically", async () => {
  render(<ReviewLinkEditor pages={pages} />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Save New Link" })).toBeEnabled());
  fireEvent.change(screen.getByLabelText("New Destination"), { target: { value: "/future" } });
  expect(screen.getByRole("button", { name: "Save New Link" })).toBeEnabled();
  expect(m.save).not.toHaveBeenCalled();
});

it("restores the original override without changing modes or unrelated approvals", async () => {
  m.resolve.mockResolvedValue({ href: "/contact", blank: false, element: { key: "0.5.0.1", scope: "page", originalHref: "/gallery" } });
  m.reset.mockResolvedValue(["Homepage: restored original link"]);
  render(<ReviewLinkEditor pages={pages} />);
  fireEvent.click(await screen.findByRole("button", { name: "Restore Original Link" }));
  await waitFor(() => expect(m.notify).toHaveBeenCalled());
  expect(m.reset).toHaveBeenCalledWith(expect.anything(), "restore");
  expect(walk.get().savedReviewLinks[0].link.href).toBe("/gallery");
  expect(walk.get().linkTicked).toEqual(["/|/team"]);
});
it("removes only navigation using the existing safe unlink action", async () => {
  const resolved = { href: "/contact", blank: false, element: { key: "0.5.0.1", scope: "page", originalHref: "/gallery" } };
  m.resolve.mockResolvedValue(resolved);
  m.refreshRemoved.mockResolvedValue({ ...resolved, href: "", updatedAt: "after-remove", edits: { "link:0.5.0.1": '{"unlinked":true}' } });
  m.reset.mockResolvedValue(["Homepage: removed link"]);
  render(<ReviewLinkEditor pages={pages} />);
  fireEvent.click(await screen.findByRole("button", { name: "Remove Link" }));
  expect(m.reset).not.toHaveBeenCalled();
  fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Remove Link" }));
  await waitFor(() => expect(m.notify).toHaveBeenCalled());
  expect(m.reset).toHaveBeenCalledWith(expect.anything(), "remove");
  expect(walk.get().linkReplaced[link.key]).toBe("own");
  await waitFor(() => expect(screen.getByRole("button", { name: "Restore Original Link" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Restore Original Link" }));
  await waitFor(() => expect(m.reset).toHaveBeenCalledWith(expect.objectContaining({ updatedAt: "after-remove" }), "restore"));
});
it("canceling removal does not write or change approvals", async () => {
  m.resolve.mockResolvedValue({ href: "/contact", blank: false, element: { key: "0.5.0.1", scope: "page", originalHref: "/gallery" } });
  render(<ReviewLinkEditor pages={pages} />);
  fireEvent.click(await screen.findByRole("button", { name: "Remove Link" }));
  fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Cancel" }));
  expect(m.reset).not.toHaveBeenCalled();
  expect(walk.get().linkTicked).toEqual(["/|/team"]);
});
