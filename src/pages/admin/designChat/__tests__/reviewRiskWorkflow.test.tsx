import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SubmitWalkthroughPanel, ownLinkPrint } from "../SubmitWalkthrough";
import { walk } from "../submitWalkthroughStore";
import type { ReviewLink } from "../submitWalkthrough";
const m = vi.hoisted(() => ({ data: null as any, trust: vi.fn(), domains: [] as string[], show: vi.fn() }));
vi.mock("../DesignChatContext", () => ({ useDesignChat: () => ({ state: { publish: { open: 3 }, review: { enabled: true } }, preview: null, showPreviewPath: m.show }) }));
vi.mock("../useWalkthroughData", () => ({ useWalkthroughData: () => m.data }));
vi.mock("../trustedDomains", () => ({ useTrustedDomains: () => ({ domains: m.domains, isAdmin: true, pending: false, error: "", change: m.trust }), TrustedDomainList: () => null }));
const a: ReviewLink = { key: "a", href: "https://example.com/a", originalHref: "/about", kind: "external", label: "Our Story", requestIds: [], status: null };
beforeEach(() => {
  walk.reset(); m.trust.mockClear(); m.domains=[];
  m.data = { rows: [], pages: [{ name: "About", path: "/about", build_status: "ready" }], links: { status: "ok", groups: [{ label: "Homepage", page: { name: "Homepage", path: "/" }, links: [a, { ...a, key: "b", href: "/missing", kind: "internal", label: "Missing" }, { ...a, key: "c", href: "/about", kind: "internal", label: "About" }] }], unread: 0 } };
  walk.update(s => ({ ...s, open: true, step: "links", autoOpen: false }));
});
afterEach(cleanup);
const keys = () => Array.from(document.querySelectorAll<HTMLElement>("[data-walk-link]")).map(el => el.dataset.walkLink);
it("sorts missing before external before internal, then leaves confirmed rows in place", () => {
  render(<SubmitWalkthroughPanel onKeepEditing={() => {}} />);
  expect(keys()).toEqual(["b", "a", "c"]);
  fireEvent.click(screen.getByRole("link", { name: "Open link to verify Our Story" }));
  fireEvent.click(screen.getByRole("button", { name: "Approve: Our Story" }));
  expect(walk.get().linkTicked).toContain("a"); expect(keys()).toEqual(["b", "a", "c"]);
});
it("stored trusted domains never bypass the opening or approval gate", () => {
  m.domains = ["example.com"]; m.data.links.groups[0].links = [a];
  render(<SubmitWalkthroughPanel onKeepEditing={() => {}} />);
  expect(screen.getByRole("button", { name: "Approve: Our Story" })).toBeDisabled();
  expect(walk.get().linkTicked).toEqual([]);
  expect(m.trust).not.toHaveBeenCalled();
});
it("never offers trust on a confirmed lookalike", () => {
  m.data.links.groups[0].links = [{ ...a, href: "https://lnstagram.com" }];
  render(<SubmitWalkthroughPanel onKeepEditing={() => {}} />);
  act(() => walk.confirmLink("a", ownLinkPrint(m.data.links.groups[0].links[0]), true));
  expect(screen.queryByRole("button", { name: "Trust lnstagram.com" })).toBeNull();
});
it("Design Check keeps shared facts without source authors or duplicate approval chips", () => {
  m.data.rows = [{key:"page:/about",page:{name:"About",path:"/about"},how:"Changed by the builder · Edited by hand · Shared piece: Footer",by:"staff",fingerprint:"v1"}];
  walk.update(s=>({...s,step:"pages",viewed:["page:/about"],ticked:["page:/about"],approvals:{"page:/about":"v1"}}));
  render(<SubmitWalkthroughPanel onKeepEditing={()=>{}} />);
  expect(screen.getByText("Shared piece: Footer")).toBeInTheDocument();
  expect(screen.getByRole("checkbox", { name: "Approve About" })).toBeChecked();
  expect(screen.queryByText(/Edited by hand|Changed by the builder|by staff/)).toBeNull();
});
it("does not auto-collapse a completed group the reviewer opened by hand", () => {
  m.data.links.groups[0].links = [a];
  render(<SubmitWalkthroughPanel onKeepEditing={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "Homepage · 0 of 1" }));
  fireEvent.click(screen.getByRole("button", { name: "Homepage · 0 of 1" }));
  fireEvent.click(screen.getByRole("link", { name: /^Open link to verify / }));
  fireEvent.click(screen.getByRole("button", { name: "Approve: Our Story" }));
  expect(screen.getByRole("button", { name: "Homepage · done" })).toHaveAttribute("aria-expanded", "true");
});
it("duplicate jump expands and selects the related row without opening a destination", () => {
  m.data.links.groups[0].links = [a, { ...a, key: "d", label: "More Stories" }];
  render(<SubmitWalkthroughPanel onKeepEditing={() => {}} />);
  fireEvent.click(screen.getByText("Same destination as: More Stories"));
  fireEvent.click(screen.getAllByRole("button", {name:"Show Related Link"})[0]);
  expect(walk.get().selectedLink?.key).toBe("d"); expect(walk.get().verificationOpened).toEqual({});
});
it("legacy handled rows retain review-again and correction actions",()=>{
 m.data.links.groups[0].links=[a];walk.update(s=>({...s,linkReplaced:{a:ownLinkPrint(a)},groupExpansion:{"/":true}}));
 render(<SubmitWalkthroughPanel onKeepEditing={()=>{}}/>);expect(screen.getByRole("button",{name:"Review Again"})).toBeInTheDocument();expect(screen.getByRole("button",{name:"Correct link: Our Story"})).toBeEnabled();
 fireEvent.click(screen.getByRole("button",{name:"Review Again"}));expect(walk.get().linkReplaced.a).toBeUndefined();expect(screen.getByText("0 of 1 links approved")).toBeInTheDocument();
});
