import { expect, it, vi } from "vitest";
import { parseInventory, loadNetLinks, netReviewLinks, reviewPageInventory } from "../linkInventory";
import { comparedReviewLinks } from "../publishedLinkComparison";
import { isSiteLink } from "../siteLink";

const badge = "https://lovable.dev/projects/lovp_7t4sw40esw9h5a5cqwffntga9e";
const payload = (path: string, links: unknown[]) => ({ source: "nova-site", type: "link-inventory", v: 1, path, links });
const real = (key: string, href: string, label: string) => ({ key, href, label, scope: "page" });
it("collects all changed pages without a mounted preview, retaining its signed draft address", async () => {
  const request = vi.fn(async (url: string) => ({ path: new URL(url).pathname, links: [real("0", "/contact", "Contact")], complete: true }));
  const result = await loadNetLinks(["/", "/draft/pricing", "/contact"], null, request, null, "https://id-preview--aeb60cc1-b08d-4938-9d83-88c44335e167.lovable.app/?__lovable_token=test");
  expect(Object.keys(result).sort()).toEqual(["/", "/contact", "/draft/pricing"]);
  expect(request).toHaveBeenCalledTimes(3);
  expect(request.mock.calls.every(([url]) => new URL(url).searchParams.get("__lovable_token") === "test")).toBe(true);
});
it("excludes an injected badge anchor and explicitly outside-root links from the frame reply", () => {
  document.body.innerHTML = `<main data-inline-root><a href="/brands">Discuss pricing</a></main><aside><a href="${badge}">Edit with Lovable</a><a href="https://shell.example">Shell</a></aside>`;
  const links = Array.from(document.querySelectorAll<HTMLAnchorElement>("a")).map((a, i) => ({ ...real(String(i), a.getAttribute("href") ?? "", a.textContent ?? ""), contentOwned: !!a.closest("[data-inline-root]") }));
  expect(parseInventory(payload("/draft/pricing", links))?.links.map(l => l.href)).toEqual(["/brands"]);
  document.body.innerHTML = "";
});
it("rejects platform editor URLs without rejecting real visitor URLs hosted on lovable.app", () => {
  expect(isSiteLink(badge)).toBe(false);
  expect(isSiteLink("https://x.lovable.app/projects/abc")).toBe(false);
  expect(isSiteLink("https://x.lovable.app/brands")).toBe(true);
});
it("does not replace real relay rows with a badge-only offscreen inventory", async () => {
  const inventory = parseInventory(payload("/", [real("9", badge, "Edit") ]));
  expect(inventory?.complete).toBe(false);
  const nets = await loadNetLinks(["/"], null, async () => inventory);
  const base = { unread: 0, partial: false, truncated: false, groups: [{ page: { path: "/", name: "Homepage" }, label: "Homepage", links: [{ key: "gallery", href: "/inspiration-gallery", kind: "internal" as const, label: "Gallery", requestIds: [], status: null }] }] };
  expect(comparedReviewLinks(netReviewLinks(base, nets, [])).groups[0].links.map(l => l.href)).toEqual(["/inspiration-gallery"]);
});
it("lists three Homepage and three Pricing links, excludes equal links, shared chrome and badges", () => {
  const home = parseInventory(payload("/", [real("0", "/inspiration-gallery", "Gallery Image"), real("1", "/contact", "Contact Image"), real("2", "/contact", "Book a Consultation"), { ...real("3", "/brands", "Restored"), publishedHref: "/brands" }, real("9", badge, "Edit"), { ...real("10", "/contact", "Header"), scope: "object:header" }]));
  const pricing = parseInventory({ ...payload("/draft/pricing", [real("0", "/brands", "Discuss pricing"), real("1", "/contact", "Contact"), real("2", "/inspiration-gallery", "Gallery"), real("9", badge, "Edit"), { ...real("10", "/contact", "Footer"), scope: "object:footer" }]), published: false });
  if (!home || !pricing) throw new Error("fixture invalid");
  const result = comparedReviewLinks(netReviewLinks({ groups: [], unread: 0, partial: false, truncated: false }, { "/": reviewPageInventory(home, null), "/draft/pricing": reviewPageInventory(pricing, { ...pricing, published: false }) }, [{ name: "Homepage", path: "/", build_status: "ready" }, { name: "Pricing", path: "/draft/pricing", build_status: "ready" }]));
  expect(result.groups.map(g => [g.label, g.links.length])).toEqual([["Homepage", 3], ["Pricing", 3]]);
  expect(result.groups.flatMap(g => g.links)).toHaveLength(6);
  expect(result.groups[1].links[0].href).toBe("/brands");
});