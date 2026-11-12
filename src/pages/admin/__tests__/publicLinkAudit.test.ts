import { describe, expect, it } from "vitest";
import { buildAuditRows, classifyLink, destinationOf, pageProblems, statusLabel, unscannedDestinations, type PageScan, type ScannedLink } from "../publicLinkAudit";

const SITE = "https://public.example.com";
const link = (href: string, text: string, area: ScannedLink["area"] = "page"): ScannedLink => ({ href, url: href.startsWith("/") ? `${SITE}${href}` : href, text, area });
const ok = (path: string, links: ScannedLink[] = []): PageScan => ({ path, status: "ok", finalPath: path, links });

describe("where a link goes", () => {
  it.each([
    ["/about", { kind: "internal", path: "/about" }],
    ["/about/", { kind: "internal", path: "/about" }],
    ["/home", { kind: "internal", path: "/" }],
    [`${SITE}/team?x=1#bio`, { kind: "internal", path: "/team" }],
    ["https://other.example/x", { kind: "external", value: "https://other.example/x" }],
    ["mailto:hi@example.com", { kind: "contact", value: "mailto:hi@example.com" }],
    ["tel:+15555550100", { kind: "contact", value: "tel:+15555550100" }],
    ["#top", { kind: "same-page", value: "#top" }],
    ["", { kind: "same-page", value: "" }],
    ["javascript:void(0)", { kind: "external", value: "javascript:void(0)" }],
  ])("%s", (href, expected) => {
    expect(destinationOf({ href, url: href.startsWith("/") ? `${SITE}${href}` : href }, SITE)).toEqual(expected);
  });
});

describe("whether it works", () => {
  const results = new Map<string, PageScan>([
    ["/about", ok("/about")],
    ["/brands", { path: "/brands", status: "coming-soon", finalPath: "/brands", links: [] }],
    ["/gone", { path: "/gone", status: "not-found", finalPath: "/gone", links: [] }],
    ["/slow", { path: "/slow", status: "unreachable" }],
    ["/landing/sale", ok("/landing/sale")],
  ]);
  const at = (path: string) => ({ kind: "internal" as const, path });
  it("uses what the public site actually showed for the destination", () => {
    expect(classifyLink(at("/about"), "/", results)).toEqual({ status: "Registered", type: "Page" });
    expect(classifyLink(at("/landing/sale"), "/", results)).toEqual({ status: "Registered", type: "Landing Page" });
    expect(classifyLink(at("/brands"), "/", results)).toEqual({ status: "Pending", type: "Coming Soon" });
    expect(classifyLink(at("/gone"), "/", results)).toEqual({ status: "Broken", type: "Missing Page" });
    expect(classifyLink(at("/slow"), "/", results)).toEqual({ status: "Unchecked", type: "Page" });
    expect(classifyLink(at("/never-scanned"), "/", results)).toEqual({ status: "Unchecked", type: "Page" });
  });
  it("marks links back to the same page, except header and footer links", () => {
    expect(classifyLink(at("/about"), "/about", results).status).toBe("Self-Referencing");
    expect(classifyLink(at("/about"), null, results).status).toBe("Registered");
  });
  it("shows plain labels", () => {
    expect(["Registered", "Pending", "Broken", "External", "Self-Referencing", "Unchecked"].map(statusLabel))
      .toEqual(["Link Works", "Coming Soon", "Page Not Found", "Other Site", "Same Page", "Couldn't Check (Timed Out)"]);
    expect(statusLabel("Something Old")).toBe("Something Old");
  });
});

describe("audit rows", () => {
  it("keeps two same-worded links with different destinations as separate rows", () => {
    const pages = [ok("/", [link("/about", "Learn More"), link("/gone", "Learn More")])];
    const results = new Map<string, PageScan>([["/", pages[0]], ["/about", ok("/about")], ["/gone", { path: "/gone", status: "not-found", finalPath: "/gone", links: [] }]]);
    const rows = buildAuditRows(pages, results, SITE);
    expect(rows.map((r) => [r.link_text, r.destination, r.status])).toEqual([
      ["Learn More", "/about", "Registered"],
      ["Learn More", "/gone", "Broken"],
    ]);
  });
  it("records header and footer links once for the whole site, from every page", () => {
    const pages = [
      ok("/", [link("/about", "About", "header"), link("/privacy", "Privacy", "footer")]),
      ok("/team", [link("/about", "About", "header"), link("/careers", "Careers", "header")]),
    ];
    const results = new Map(pages.map((p) => [p.path, p] as [string, PageScan]));
    const rows = buildAuditRows(pages, results, SITE);
    const header = rows.filter((r) => r.location === "Header");
    expect(header.map((r) => r.link_text)).toEqual(["About", "Careers"]);
    expect(header.every((r) => r.is_chrome)).toBe(true);
    expect(header[0].source_pages).toEqual(["/", "/team"]);
    expect(rows.find((r) => r.location === "Footer")?.link_text).toBe("Privacy");
  });
  it("skips pages that didn't load as real pages, and reports them instead", () => {
    const pages: PageScan[] = [
      ok("/", [link("/about", "About")]),
      { path: "/old", status: "not-found", finalPath: "/old", links: [] },
      { path: "/brands", status: "coming-soon", finalPath: "/brands", links: [link("/x", "X")] },
      { path: "/slow", status: "unreachable" },
    ];
    const rows = buildAuditRows(pages, new Map(), SITE);
    expect(rows.map((r) => r.location)).toEqual(["/"]);
    expect(pageProblems(pages)).toEqual([
      { path: "/old", problem: "not-found" },
      { path: "/brands", problem: "coming-soon" },
      { path: "/slow", problem: "unreachable" },
    ]);
  });
  it("lists linked pages that still need loading, never Site Manager or internal addresses", () => {
    const pages = [ok("/", [link("/about", "About"), link("/brands", "Brands"), link("/manage/pages", "Manage"), link("/__object/1", "Obj"), link("https://x.example", "X"), link("/", "Home")])];
    expect(unscannedDestinations(pages, SITE)).toEqual(["/about", "/brands"]);
  });
});
