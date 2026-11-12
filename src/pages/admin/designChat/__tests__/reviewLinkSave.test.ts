import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ inventory: null as any, row: null as any, save: vi.fn(), table: "", filters: [] as any[] }));
vi.mock("../linkInventory", () => ({ requestInventory: async () => m.inventory }));
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
    await expect(resolveReviewLink("/", "/contact", null)).rejects.toThrow("We couldn't find this link on the page");
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