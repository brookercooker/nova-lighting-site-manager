import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ inventory: null as any, row: null as any, save: vi.fn(), table: "", filters: [] as any[] }));
vi.mock("../linkInventory", () => ({ requestInventory: async () => m.inventory, requestFrameInventory: async () => m.inventory }));
vi.mock("../../saveRow", () => ({ saveRow: m.save }));
vi.mock("@/prototype/client", () => ({ supabase: { from: (table: string) => { m.table = table; const q = { select: () => q, eq: (key: string, value: string) => { m.filters.push([key, value]); return q; }, maybeSingle: async () => ({ data: m.row, error: null }) }; return q; } } }));
import { resolveReviewLink, saveReviewLink } from "../reviewLinkSave";
import { validTextLink } from "../../textAdornment";
beforeEach(() => {
  vi.clearAllMocks(); m.filters = [];
  m.inventory = { path: "/", links: [{ key: "0.5.0.1", scope: "page", href: "/contact", label: "Book a Consultation", target: "_blank", originalHref: "/contact", fingerprint: '{"v":1,"tag":"div","t":"abc"}' }] };
  m.row = { id: "p", name: "Homepage", updated_at: "version1", inline_edits: { "html:0.1": "untouched" } };
  m.save.mockResolvedValue({ error: null });
});
describe("review link writes", () => {
  it("adopts inventory fp only when absent for the unique Inspiration Gallery link", async () => {
    m.inventory.links = [{ ...m.inventory.links[0], key: "0.5.0.0", href: "/inspiration-gallery", originalHref: "/contact", label: "BOOK A CONSULTATION" }];
    m.row.inline_edits["link:0.5.0.0"] = '{"href":"/inspiration-gallery"}';
    const r = await resolveReviewLink("/", "/inspiration-gallery", "Link to Inspiration Gallery");
    expect(r.edits["fp:0.5.0.0"]).toBe(m.inventory.links[0].fingerprint);
    await saveReviewLink(r, "/contact", false);
    expect(m.save.mock.calls[0][1].inline_edits["link:0.5.0.0"]).toBe('{"href":"/contact"}');
    expect(m.save.mock.calls[0][1].inline_edits["fp:0.5.0.0"]).toBe(m.inventory.links[0].fingerprint);
  });
  it("preserves an existing stored fingerprint even when inventory has a different one", async () => {
    const stored = '{"v":1,"tag":"div","t":"stored"}';
    m.row.inline_edits["fp:0.5.0.1"] = stored;
    const r = await resolveReviewLink("/", "/contact", null);
    expect(r.edits["fp:0.5.0.1"]).toBe(stored);
    await saveReviewLink(r, "/gallery", false);
    expect(m.save.mock.calls[0][1].inline_edits["fp:0.5.0.1"]).toBe(stored);
  });
  it("logs only mismatch field/booleans and never calls pre-existing href skew a new change", async () => {
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    m.row.inline_edits["link:0.5.0.1"] = '{"href":"/other?__lovable_token=secret-value"}';
    await expect(resolveReviewLink("/", "/contact", null)).rejects.toThrow("saved link and the page don't match yet");
    expect(debug).toHaveBeenCalledWith("[review-link] metadata mismatch", { field: "href", storedOverride: true, inventoryMatchesReview: true });
    expect(JSON.stringify(debug.mock.calls)).not.toContain("secret-value");
    expect(JSON.stringify(debug.mock.calls)).not.toContain("/other");
    debug.mockRestore();
  });
  it("matches stored page key first among three Contact links and shared links, ignoring Manager labels", async () => {
    m.inventory.links = [
      { ...m.inventory.links[0], label: "EXPLORE GALLERIES", originalHref: "/inspiration-gallery" },
      { ...m.inventory.links[0], key: "0.7.0.0.1.1", label: "TALK TO A CONSULTANT" },
      { ...m.inventory.links[0], key: "0.14.1.0.1.3.1", label: "BOOK A CONSULTATION" },
      { ...m.inventory.links[0], scope: "object:footer" },
    ];
    m.row.inline_edits["link:0.5.0.1"] = '{"href":"/contact"}';
    const r = await resolveReviewLink("/", "/contact", "Link to Contact", undefined, { elementKey: "link:0.5.0.1", scope: "page" });
    await saveReviewLink(r, "/gallery", false);
    expect(m.save.mock.calls[0][1].inline_edits["link:0.5.0.1"]).toBe('{"href":"/gallery"}');
    expect(r.element.label).toBe("EXPLORE GALLERIES");
    await expect(resolveReviewLink("/", "/contact", "BOOK A CONSULTATION", undefined, { elementKey: "0.99", scope: "page" })).rejects.toThrow("pin down");
  });
  it.each(["https://example.com/a", "mailto:a@b.co", "tel:+15550100", "/gallery"])("uses the Manual destination validation for %s", href => expect(validTextLink(href)).toBe(true));
  it.each(["http://example.com", "//example.com", "javascript:alert(1)", "#faq", "https://", "mailto:", "tel:", "/a b", "/a\\b"])("rejects %s before any save", async href => {
    const r = await resolveReviewLink("/", "/contact", null);
    await expect(saveReviewLink(r, href, false)).rejects.toThrow("Use https://");
    expect(m.save).not.toHaveBeenCalled();
  });
  it("uses the real wrapper key, preserves fingerprints/other edits/target, and returns the normal change record", async () => {
    const r = await resolveReviewLink("/", "/contact", null);
    expect(r.blank).toBe(true);
    const lines = await saveReviewLink(r, "/gallery", true);
    expect(m.save).toHaveBeenCalledWith("pages", expect.objectContaining({ inline_edits: { "html:0.1": "untouched", "fp:0.5.0.1": '{"v":1,"tag":"div","t":"abc"}', "link:0.5.0.1": '{"href":"/gallery","target":"_blank"}' } }), "p", "version1");
    expect(lines[0]).toContain('Homepage: Changed link: Book a Consultation to /gallery');
  });
  it("writes an object scope to its registry row, never the page", async () => {
    m.inventory.links[0].scope = "object:obj1";
    await saveReviewLink(await resolveReviewLink("/", "/contact", null), "/gallery", false);
    expect(m.filters).toEqual([["id", "obj1"]]);
    expect(m.save.mock.calls[0][0]).toBe("object_registry");
  });
  it.each(["missing", "ambiguous", "target", "fingerprint"])("fails closed on %s resolution", async what => {
    if (what === "missing") m.inventory = null;
    if (what === "ambiguous") m.inventory.links.push({ ...m.inventory.links[0], key: "0.2" });
    if (what === "target") delete m.inventory.links[0].target;
    if (what === "fingerprint") delete m.inventory.links[0].fingerprint;
    await expect(resolveReviewLink("/", "/contact", null)).rejects.toThrow("We couldn't pin down which link this is.");
    expect(m.save).not.toHaveBeenCalled();
  });
  it("propagates conflict errors without saving another map", async () => {
    m.save.mockResolvedValue({ error: { message: "This page changed while you were editing." } });
    await expect(saveReviewLink(await resolveReviewLink("/", "/contact", null), "/gallery", false)).rejects.toThrow("changed while");
  });
  it("never stores the preview token in a destination", async () => {
    await saveReviewLink(await resolveReviewLink("/", "/contact", null), "/gallery?__lovable_token=test-credential&view=all", false);
    const value = m.save.mock.calls[0][1].inline_edits["link:0.5.0.1"];
    expect(JSON.parse(value).href).toBe("/gallery?view=all");
    expect(value).not.toContain("test-credential");
  });
});