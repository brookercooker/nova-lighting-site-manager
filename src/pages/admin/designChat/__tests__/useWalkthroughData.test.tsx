import { renderHook, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchReviewPages, useWalkthroughData, mergeSavedReviewLinks } from "../useWalkthroughData";
import type { ReactNode } from "react";

const m = vi.hoisted(() => ({ headers: vi.fn(), from: vi.fn() }));
vi.mock("../helper", () => ({ RELAY: "https://relay.example", relayHeaders: m.headers }));
vi.mock("@/prototype/client", () => ({ supabase: { from: m.from } }));
vi.mock("../../siteManifest", () => ({ loadSiteManifest: async () => ({}), codePagePaths: () => [] }));
const body = { ok: true, rows: [{ name: "Experiment", path: "/draft/experiment", how: ["chat"], requestIds: ["1"] }], components: [], objects: [], sitewide: { files: [] } };
beforeEach(() => {
  m.headers.mockResolvedValue({ Authorization: "Bearer test-staff" });
  m.from.mockImplementation((table: string) => {
    const result = { data: table === "pages" ? [{ name: "Manager Experiment", path: "/draft/experiment", build_status: "draft" }] : [], error: null };
    const q: any = { select: () => q, is: () => Promise.resolve(result), in: () => Promise.resolve(result) };
    return q;
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
describe("review pages fetch", () => {
  it("adds the saved destination while relay rows lag, but respects a current empty net inventory", () => {
    const old = { key: "/|/contact", href: "/contact", kind: "internal" as const, label: null, requestIds: [], status: null };
    const next = { ...old, key: "/|/gallery", href: "/gallery" };
    const base = { groups: [{ page: { name: "Homepage", path: "/" }, label: "Homepage", links: [old] }], unread: 0, partial: false, truncated: false };
    expect(mergeSavedReviewLinks(base, [{ path: "/", link: next }], [], {}).groups[0].links.map(l => l.href)).toEqual(["/contact", "/gallery"]);
    expect(mergeSavedReviewLinks({ ...base, groups: [] }, [{ path: "/", link: next }], [], { "/": [] }).groups).toEqual([]);
  });
  it("changes the page fingerprint after saved hand-edit values change even with the same relay request", async () => {
    let inline = { heading: "First hand edit" };
    m.from.mockImplementation((table: string) => {
      const result = { data: table === "pages" ? [{ name: "Experiment", path: "/draft/experiment", build_status: "ready", inline_edits: inline }] : [], error: null };
      const q: any = { select: () => q, is: () => Promise.resolve(result), in: () => Promise.resolve(result) }; return q;
    });
    vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith("review-pages") ? body : { ok: true, groups: [] }))));
    const client = new QueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const state: any = { draft: { requests: [{ id: "1", at: 123, request: "Hand edit" }] } };
    const hook = renderHook(() => useWalkthroughData(state, true), { wrapper });
    await waitFor(() => expect(hook.result.current.pagesStatus).toBe("ok"));
    const before = hook.result.current.rows[0].fingerprint;
    inline = { heading: "Later hand edit" };
    await client.invalidateQueries({ queryKey: ["walkthrough", "pages"] });
    await waitFor(() => expect(hook.result.current.rows[0].fingerprint).not.toBe(before));
  });
  it.each([404, "network"])("falls back only for %s", async (failure) => {
    vi.stubGlobal("fetch", failure === "network" ? vi.fn().mockRejectedValue(new TypeError("offline")) : vi.fn().mockResolvedValue(new Response("", { status: 404 })));
    expect(await fetchReviewPages()).toBeNull();
  });
  it.each([401, 403, 500])("does not derive viewed pages on HTTP %s", async (status) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status })));
    await expect(fetchReviewPages()).rejects.toThrow(String(status));
  });
  it("uses existing base and staff authentication", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(body)));
    vi.stubGlobal("fetch", fetcher);
    expect((await fetchReviewPages())?.rows[0].path).toBe("/draft/experiment");
    expect(fetcher).toHaveBeenCalledWith("https://relay.example/api/review-pages", { cache: "no-store", headers: { Authorization: "Bearer test-staff" } });
  });
  it("refetches on reopening and new changes and never exposes Contact while loading", async () => {
    const fetcher = vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith("review-pages") ? body : { ok: true, groups: [] })));
    vi.stubGlobal("fetch", fetcher);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const state: any = { previewVersion: 1, draft: { requests: [{ id: "1", request: "Change Experiment", siteFiles: 0, page: { name: "Contact", path: "/contact" } }] } };
    const hook = renderHook(({ value }) => useWalkthroughData(value, true), { wrapper, initialProps: { value: state } });
    expect(hook.result.current.rows).toEqual([]);
    await waitFor(() => expect(hook.result.current.rows[0]?.page?.name).toBe("Manager Experiment"));
    hook.rerender({ value: { ...state, draft: { requests: [...state.draft.requests, { id: "2", request: "Another change" }] } } });
    await waitFor(() => expect(fetcher.mock.calls.filter(([url]) => url.endsWith("review-pages"))).toHaveLength(2));
    hook.unmount();
    renderHook(() => useWalkthroughData(state, true), { wrapper });
    await waitFor(() => expect(fetcher.mock.calls.filter(([url]) => url.endsWith("review-pages"))).toHaveLength(3));
  });
  it("resolves component_key and object name through registry IDs", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith("review-pages") ? { ...body, components: [{ name: "MailchimpForm", requestIds: [] }] } : { ok: true, groups: [] }))));
    m.from.mockImplementation((table: string) => {
      const result = { data: table === "object_registry" ? [{ id: "obj", name: "Newsletter Form", component_key: "MailchimpForm" }] : table === "object_page_usages" ? [{ object_registry_id: "obj", pages: { name: "Contact", path: "/contact" } }] : [], error: null };
      const q: any = { select: () => q, is: () => Promise.resolve(result), in: (ids: string, values: string[]) => { expect([ids, values]).toEqual(["object_registry_id", ["obj"]]); return Promise.resolve(result); } };
      return q;
    });
    const client = new QueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const hook = renderHook(() => useWalkthroughData(null, true), { wrapper });
    await waitFor(() => expect(hook.result.current.rows.find((r) => r.page?.path === "/contact")?.how).toBe("Shared piece: MailchimpForm"));
  });
});