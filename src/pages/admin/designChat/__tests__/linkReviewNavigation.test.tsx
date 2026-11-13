import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SubmitWalkthroughPanel, ownLinkPrint } from "../SubmitWalkthrough";
import { walk } from "../submitWalkthroughStore";
import type { ReviewLink } from "../submitWalkthrough";

const m = vi.hoisted(() => ({ data: null as any, show: vi.fn() }));
vi.mock("../DesignChatContext", () => ({ useDesignChat: () => ({ state: { publish: { open: 2 }, review: { enabled: true } }, showPreviewPath: m.show, preview: null }) }));
vi.mock("../useWalkthroughData", () => ({ useWalkthroughData: () => m.data }));
const link = (key: string): ReviewLink => ({ key, href: `https://example.com/${key}`, kind: "external", label: key, elementKey: "0.1", scope: "page", requestIds: [], status: null });
beforeEach(() => {
  const preview = document.createElement("section");
  preview.id = "link-review-navigation";
  document.body.appendChild(preview);
  walk.reset(); m.show.mockClear();
  m.data = { rows: [], pages: [], pagesStatus: "ok", links: { status: "ok", unread: 0, partial: false, truncated: false, groups: [
    { label: "Homepage", page: { name: "Homepage", path: "/" }, links: [link("first")] },
    { label: "Pricing", page: { name: "Pricing", path: "/draft/pricing" }, links: [link("second")] },
  ] } };
  walk.update(s => ({ ...s, open: true, step: "links" }));
});
afterEach(() => { cleanup(); document.getElementById("link-review-navigation")?.remove(); walk.reset(); vi.restoreAllMocks(); });
const header = () => within(screen.getByRole("region", { name: "Link Review Navigation" }));

it.each([320, 375, 1280])("selects each source page and exact link without approval on navigation at %spx", width => {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  render(<SubmitWalkthroughPanel onKeepEditing={() => {}} />);
  expect(m.show).toHaveBeenLastCalledWith("/");
  expect(walk.get().openingLink).toMatchObject({ key: "first", path: "/", elementKey: "0.1", scope: "page" });
  expect(header().getByRole("button", { name: "Previous Link" })).toBeDisabled();
  fireEvent.click(header().getByRole("button", { name: "Next Link" }));
  expect(m.show).toHaveBeenLastCalledWith("/draft/pricing");
  expect(walk.get().openingLink).toMatchObject({ key: "second", path: "/draft/pricing", elementKey: "0.1", scope: "page" });
  expect(walk.get().linkTicked).toEqual([]);
  expect(header().getByRole("button", { name: "Next Link" })).toBeDisabled();
  fireEvent.click(header().getByRole("button", { name: "Previous Link" }));
  expect(m.show).toHaveBeenLastCalledWith("/");
});
it("requires a successful own-link opening, approves once and advances across pages without Submit", () => {
  render(<SubmitWalkthroughPanel onKeepEditing={() => {}} />);
  expect(header().getByRole("button", { name: "Approve Current Link and Continue" })).toBeDisabled();
  const tab = { opener: window, document: document.implementation.createHTMLDocument(), close: vi.fn() };
  vi.spyOn(window, "open").mockReturnValue(tab as unknown as Window);
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  fireEvent.click(header().getByRole("link", { name: "Open Current Link to Verify" }));
  expect(walk.get().verificationOpened.first).toBe(ownLinkPrint(link("first")));
  fireEvent.click(header().getByRole("button", { name: "Approve Current Link and Continue" }));
  expect(walk.get().linkTicked).toEqual(["first"]);
  expect(m.show).toHaveBeenLastCalledWith("/draft/pricing");
  expect(header().getByRole("button", { name: "Approve Current Link and Continue" })).toBeDisabled();
  act(() => walk.openedVerification("second", ownLinkPrint(link("second"))));
  fireEvent.click(header().getByRole("button", { name: "Approve Current Link and Continue" }));
  expect(walk.get().linkTicked).toEqual(["first", "second"]);
  expect(walk.get().step).toBe("links");
  fireEvent.click(header().getByRole("button", { name: "Approve Current Link and Continue" }));
  expect(walk.get().linkTicked).toEqual(["first", "second"]);
});
it("keeps missing destinations blocked even with an opening record", () => {
  const missing = { ...link("missing"), kind: "internal", href: "/missing" };
  m.data.links.groups[0].links = [missing];
  act(() => walk.openedVerification("missing", ownLinkPrint(missing as ReviewLink)));
  render(<SubmitWalkthroughPanel onKeepEditing={() => {}} />);
  expect(header().getByRole("button", { name: "Approve Current Link and Continue" })).toBeDisabled();
});
it("blocked verification tabs never unlock the header approval", () => {
  vi.spyOn(window, "open").mockReturnValue(null);
  render(<SubmitWalkthroughPanel onKeepEditing={() => {}} />);
  fireEvent.click(header().getByRole("link", { name: "Open Current Link to Verify" }));
  expect(header().getByRole("button", { name: "Approve Current Link and Continue" })).toBeDisabled();
  expect(walk.get().verificationOpened).toEqual({});
});
it("shows shared links on a registered usage page", () => {
  m.data.links.groups = [{ label: "Footer", page: null, shared: { id: "footer", name: "Footer", pages: [{ name: "Contact", path: "/contact" }] }, links: [{ ...link("shared"), scope: "object:footer" }] }];
  render(<SubmitWalkthroughPanel onKeepEditing={() => {}} />);
  expect(m.show).toHaveBeenLastCalledWith("/contact");
  expect(walk.get().openingLink).toMatchObject({ key: "shared", path: "/contact", scope: "object:footer" });
});