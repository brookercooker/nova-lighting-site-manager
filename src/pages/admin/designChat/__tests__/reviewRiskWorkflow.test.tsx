import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SubmitWalkthroughPanel, ownLinkPrint } from "../SubmitWalkthrough";
import { walk } from "../submitWalkthroughStore";
import type { ReviewLink } from "../submitWalkthrough";
const m = vi.hoisted(() => ({ data: null as any, trust: vi.fn(), show: vi.fn() }));
vi.mock("../DesignChatContext", () => ({ useDesignChat: () => ({ state: { publish: { open: 3 }, review: { enabled: true } }, preview: null, showPreviewPath: m.show }) }));
vi.mock("../useWalkthroughData", () => ({ useWalkthroughData: () => m.data }));
vi.mock("../trustedDomains", () => ({ useTrustedDomains: () => ({ domains: [], isAdmin: true, pending: false, error: "", change: m.trust }), TrustedDomainList: () => null }));
const a: ReviewLink = { key: "a", href: "https://example.com/a", originalHref: "/about", kind: "external", label: "Our Story", requestIds: [], status: null };
beforeEach(() => {
  walk.reset(); m.trust.mockClear();
  m.data = { rows: [], pages: [{ name: "About", path: "/about", build_status: "ready" }], links: { status: "ok", groups: [{ label: "Homepage", page: { name: "Homepage", path: "/" }, links: [a, { ...a, key: "b", href: "/missing", kind: "internal", label: "Missing" }, { ...a, key: "c", href: "/about", kind: "internal", label: "About" }] }], unread: 0 } };
  walk.update(s => ({ ...s, open: true, step: "links", autoOpen: false }));
});
afterEach(cleanup);
const keys = () => Array.from(document.querySelectorAll<HTMLElement>("[data-walk-link]")).map(el => el.dataset.walkLink);
it("sorts missing before external before internal, then leaves confirmed rows in place", () => {
  render(<SubmitWalkthroughPanel onKeepEditing={() => {}} />);
  expect(keys()).toEqual(["b", "a", "c"]);
  fireEvent.click(screen.getAllByRole("link", { name: "Open Link to Verify" })[1]);
  fireEvent.click(screen.getByRole("button", { name: "Confirmed: Our Story" }));
  expect(walk.get().linkTicked).toContain("a"); expect(keys()).toEqual(["b", "a", "c"]);
});
it("offers trust only after confirming a safe external destination", () => {
  render(<SubmitWalkthroughPanel onKeepEditing={() => {}} />);
  expect(screen.queryByRole("button", { name: "Trust example.com" })).toBeNull();
  act(() => { walk.openedVerification(a.key, ownLinkPrint(a)); walk.confirmLink(a.key, ownLinkPrint(a), true); });
  fireEvent.click(screen.getByRole("button", { name: "Trust example.com" }));
  expect(m.trust).toHaveBeenCalledWith("example.com");
});
it("never offers trust on a confirmed lookalike", () => {
  m.data.links.groups[0].links = [{ ...a, href: "https://lnstagram.com" }];
  render(<SubmitWalkthroughPanel onKeepEditing={() => {}} />);
  act(() => walk.confirmLink("a", ownLinkPrint(m.data.links.groups[0].links[0]), true));
  expect(screen.queryByRole("button", { name: "Trust lnstagram.com" })).toBeNull();
});
it("does not auto-collapse a completed group the reviewer opened by hand", () => {
  m.data.links.groups[0].links = [a];
  render(<SubmitWalkthroughPanel onKeepEditing={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "Collapse All" }));
  fireEvent.click(screen.getByRole("button", { name: "Homepage · 0 of 1" }));
  fireEvent.click(screen.getByRole("link", { name: "Open Link to Verify" }));
  fireEvent.click(screen.getByRole("button", { name: "Confirmed: Our Story" }));
  expect(screen.getByRole("button", { name: "Homepage · done" })).toHaveAttribute("aria-expanded", "true");
});
it("duplicate jump expands and selects the related row without opening a destination", () => {
  m.data.links.groups[0].links = [a, { ...a, key: "d", label: "More Stories" }];
  render(<SubmitWalkthroughPanel onKeepEditing={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "Same destination as: More Stories" }));
  expect(walk.get().selectedLink?.key).toBe("d"); expect(walk.get().verificationOpened).toEqual({});
});