import { renderHook, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider, type QueryObserverOptions } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchReviewPages, useWalkthroughData, mergeSavedReviewLinks, enrichReviewLinks, dropOriginalDestinations } from "../useWalkthroughData";
import type { ReactNode } from "react";

const m = vi.hoisted(() => ({ headers: vi.fn(), from: vi.fn(), inventory: vi.fn(), nets: vi.fn() }));
vi.mock("../linkInventory", async importOriginal => ({...await importOriginal<typeof import("../linkInventory")>(), requestInventory: m.inventory, loadNetLinks: m.nets}));
vi.mock("../helper", () => ({ RELAY: "https://relay.example", relayHeaders: m.headers }));
vi.mock("../DesignChatContext", () => ({ useDesignChat: () => ({ preview: { frames: [{ id: "draft", url: "https://id-preview--aeb60cc1-b08d-4938-9d83-88c44335e167.lovable.app/?__lovable_token=test" }], shownId: "draft" } }) }));
vi.mock("@/prototype/client", () => ({ supabase: { from: m.from } }));
vi.mock("../../siteManifest", () => ({ loadSiteManifest: async () => ({}), codePagePaths: () => [] }));
const body = { ok: true, rows: [{ name: "Experiment", path: "/draft/experiment", how: ["chat"], requestIds: ["1"] }], components: [], objects: [], sitewide: { files: [] } };
it("pins two same-destination links by unique wording and keeps ambiguous card rows unresolved", () => {
  const link = { key: "a", href: "/contact", label: "Book a Consultation", kind: "internal" as const, requestIds: [], status: null };
  const base = { unread: 0, partial: false, truncated: false, groups: [{ label: "Homepage", page: { path: "/", name: "Homepage" }, links: [link, { ...link, key: "b", label: "Contact Image" }, { ...link, key: "c", label: "Link to Contact" }] }] };
  const inventory = ["Book a Consultation", "Contact Image"].map((label, i) => ({ label, key: `0.${i}`, scope: "page", href: "/contact", originalHref: i ? "/gallery" : "/contact", inventoryPath: "/" }));
  const result = enrichReviewLinks(base, inventory);
  expect(result.groups[0].links.map(l => l.elementKey)).toEqual(["0.0", "0.1", undefined]);
  expect(dropOriginalDestinations(result).groups[0].links.map(l => l.key)).toEqual(["b", "c"]);
});
beforeEach(() => {
  m.nets.mockImplementation(async (paths: string[]) => Object.fromEntries(paths.map(path => [path, []])));
  m.inventory.mockResolvedValue(null);
  m.headers.mockResolvedValue({ Authorization: "Bearer test-staff" });
  m.from.mockImplementation((table: string) => {
    const result = { data: table === "pages" ? [{ name: "Manager Experiment", path: "/draft/experiment", build_status: "draft" }] : [], error: null };
    const q: any = { select: () => q, is: () => Promise.resolve(result), in: () => Promise.resolve(result) };
    return q;
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
describe("review pages fetch", () => {
  it("holds fresh review links until changed-page discovery and every inventory finish without viewing pages", async () => {
    let discover: (value: Response) => void = () => {};
    let collect: (value: Record<string, unknown[]>) => void = () => {};
    vi.stubGlobal("fetch", vi.fn((url: string) => url.endsWith("review-pages") ? new Promise<Response>(resolve => { discover = resolve; }) : Promise.resolve(new Response(JSON.stringify({ ok: true, groups: [] })))));
    m.nets.mockImplementation(() => new Promise(resolve => { collect = resolve; }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const hook = renderHook(() => useWalkthroughData(null, true), { wrapper });
    await waitFor(() => expect(client.getQueryCache().findAll({ queryKey: ["walkthrough", "links"] })[0]?.state.status).toBe("success"));
    expect(hook.result.current.links.status).toBe("loading");
    discover(new Response(JSON.stringify(body)));
    await waitFor(() => expect(m.nets).toHaveBeenCalled());
    expect(hook.result.current.links.status).toBe("loading");
    expect(m.nets.mock.calls.at(-1)?.[0]).toEqual(["/draft/experiment"]);
    expect(m.nets.mock.calls.at(-1)?.[4]).toContain("__lovable_token=test");
    collect({ "/draft/experiment": Array.from({ length: 7 }, (_, i) => ({ key: `0.${i}`, scope: "page", href: `/destination-${i}`, publishedHref: null })) });
    await waitFor(() => expect(hook.result.current.links.status).toBe("ok"));
    const result = hook.result.current.links;
    expect(result.status === "ok" && result.groups.flatMap(g => g.links).length).toBe(7);
  });
  it("never treats an unanswered changed-page inventory as an empty verified list", async () => {
    m.nets.mockResolvedValue({});
    vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith("review-pages") ? body : { ok: true, groups: [] }))));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const hook = renderHook(() => useWalkthroughData(null, true), { wrapper });
    await waitFor(() => expect(hook.result.current.links.status).toBe("failed"));
  });
  it("Retry clears a failed link source as well as reloading page inventories", async () => {
    let failed = true;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => url.endsWith("review-pages") ? new Response(JSON.stringify(body)) : failed ? new Response("", { status: 503 }) : new Response(JSON.stringify({ ok: true, groups: [] }))));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const hook = renderHook(() => useWalkthroughData(null, true), { wrapper });
    await waitFor(() => expect(hook.result.current.links.status).toBe("failed"));
    failed = false;
    hook.result.current.retryInventory?.();
    await waitFor(() => expect(hook.result.current.links.status).toBe("ok"));
  });
  it("includes all new Pricing inventory links even when the relay has no Pricing group", async () => {
    m.nets.mockResolvedValue({ "/draft/experiment": [0, 1, 2].map(i => ({ key: `0.${i}`, scope: "page", href: i === 0 ? "/brands" : "/contact", label: i === 0 ? "Discuss pricing" : `Pricing ${i}`, publishedHref: null })) });
    vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith("review-pages") ? body : { ok: true, groups: [] }))));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const hook = renderHook(() => useWalkthroughData(null, true), { wrapper });
    await waitFor(() => expect(hook.result.current.links.status).toBe("ok"));
    const result = hook.result.current.links;
    if (result.status !== "ok") throw new Error("not ready");
    expect(result.groups[0].links).toHaveLength(3);
    expect(result.groups[0].links[0]).toMatchObject({ href: "/brands", label: "Discuss pricing", publishedHref: null });
  });
  it("does not refetch any walkthrough query on returning window focus", async () => {
    const fetcher = vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith("review-pages") ? body : { ok: true, groups: [] })));
    vi.stubGlobal("fetch", fetcher);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const hook = renderHook(() => useWalkthroughData(null, true), { wrapper });
    await waitFor(() => expect(hook.result.current.links.status).toBe("ok"));
    const queries = client.getQueryCache().findAll({ queryKey: ["walkthrough"] });
    expect(queries.length).toBeGreaterThan(0);
    expect(queries.every(query => (query.options as QueryObserverOptions).refetchOnWindowFocus === false)).toBe(true);
    expect(queries.every(query => (query.options as QueryObserverOptions).refetchOnReconnect === false)).toBe(true);
  });
  it("drops restored About Us-only design checks but preserves builder changes", async () => {
    m.from.mockImplementation((table: string) => {
      const result = { data: table === "object_registry" ? [{ id: "about-us", name: "About Us", inline_edits: { "fp:0.1": "original" } }] : table === "object_page_usages" ? [{ object_registry_id: "about-us", pages: { name: "About", path: "/about" } }] : [], error: null };
      const q: any = { select: () => q, is: () => Promise.resolve(result), in: () => Promise.resolve(result) }; return q;
    });
    vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith("review-pages") ? { ...body, rows: [], objects: [{ name: "About Us", requestIds: ["1"] }] } : { ok: true, groups: [] }))));
    const client = new QueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const state: any = { draft: { requests: [{ id: "1", source: "content", request: "Restore link" }] } };
    const hook = renderHook(({ value }) => useWalkthroughData(value, true), { wrapper, initialProps: { value: state } });
    await waitFor(() => expect(hook.result.current.pagesStatus).toBe("ok"));
    expect(hook.result.current.rows).toEqual([]);
    hook.rerender({ value: { draft: { requests: [{ id: "1", source: "chat", request: "Change coded object" }] } } });
    await waitFor(() => expect(hook.result.current.rows.some(row => row.page?.path === "/about")).toBe(true));
  });
  it("includes saved About Us object links even when the relay only reports page links", async () => {
    m.from.mockImplementation((table: string) => {
      const result = { data: table === "object_registry" ? [{ id: "about-us", name: "About Us", inline_edits: { "link:0.1": '{"href":"/contact"}' } }] : table === "object_page_usages" ? [{ object_registry_id: "about-us", pages: { name: "About", path: "/about" } }, { object_registry_id: "about-us", pages: { name: "Homepage", path: "/" } }] : [], error: null };
      const q: any = { select: () => q, is: () => Promise.resolve(result), in: () => Promise.resolve(result) }; return q;
    });
    vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith("review-pages") ? { ...body, objects: [{ name: "About Us", requestIds: ["1"] }] } : { ok: true, groups: [] }))));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const hook = renderHook(() => useWalkthroughData(null, true), { wrapper });
    await waitFor(() => expect(hook.result.current.links.status).toBe("ok"));
    const result = hook.result.current.links;
    if (result.status !== "ok") throw new Error("shared links not ready");
    expect(result.groups.flatMap(g => g.links)).toHaveLength(1);
    expect(hook.result.current.comparisonUnavailable).toBe(true);
  });
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
it("waits for inventory, caches page wording/originals across changed requests, and exposes failed refresh", async () => {
 m.nets.mockResolvedValue({ "/": [{ key: "0", scope: "page", href: "/gallery", publishedHref: "/contact" }] });
 m.from.mockImplementation((table:string)=>{const result={data:table==="pages"?[{name:"Homepage",path:"/",build_status:"ready",inline_edits:{"link:0":'{"href":"/gallery"}'}}]:[],error:null}; const q:any={select:()=>q,is:()=>Promise.resolve(result),in:()=>Promise.resolve(result)};return q;});
 vi.stubGlobal("fetch",vi.fn(async (url:string)=>new Response(JSON.stringify(url.endsWith("review-pages")?{...body,rows:[{name:"Homepage",path:"/",how:["content"],requestIds:["1"]}]}:{ok:true,groups:[]}))));
 let finish:(v:unknown)=>void=()=>{};
 m.inventory.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
 const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
 const wrapper=({children}:{children:ReactNode})=><QueryClientProvider client={client}>{children}</QueryClientProvider>;
 const hook=renderHook(({version})=>useWalkthroughData({previewVersion:version} as any,true),{wrapper,initialProps:{version:1}});
 await waitFor(()=>expect(m.inventory).toHaveBeenCalled());
 expect(hook.result.current.links.status).toBe("loading");
 finish({path:"/",links:[{key:"0",scope:"page",href:"/gallery",label:"BOOK A CONSULTATION",originalHref:"/contact",publishedHref:"/contact"}]});
 await waitFor(()=>expect(hook.result.current.links.status).toBe("ok"));
 hook.rerender({version:2});
 await waitFor(()=>expect(hook.result.current.links.status).toBe("ok"));
 const result=hook.result.current.links;if(result.status!=="ok")throw new Error("not ready");
 expect(result.groups[0].links[0]).toMatchObject({label:"BOOK A CONSULTATION",originalHref:"/contact",publishedHref:"/contact"});
 expect(hook.result.current.inventoryUnavailable).toBe(true);
});

it("edits one original inventory link three times without changing group count",()=>{
 const make=(href:string)=>({key:"/|"+href,href,kind:"external" as const,label:"Book a Consultation",scope:"page",elementKey:"0.1",requestIds:[],status:null});
 let base: import("../submitWalkthrough").ReviewLinks={groups:[{page:{name:"Homepage",path:"/"},label:"Homepage",links:[make("https://gooogle.com"),{...make("/contact"),elementKey:"0.2"},{...make("/gallery"),elementKey:"0.3"}]}],unread:0,partial:false,truncated:false};
 for(const href of ["https://google.com","https://google.com/maps","https://google.com/three"]){base=mergeSavedReviewLinks(base,[{path:"/",link:make(href)}],[],{});expect(base.groups[0].links).toHaveLength(3);expect(base.groups[0].links.filter(l=>l.elementKey==="0.1")).toHaveLength(1);expect(base.groups[0].links[0].href).toBe(href);}
});

it("session saves replace the same inventory identity rather than accumulating old destinations",async()=>{
 const {walk}=await import("../submitWalkthroughStore");walk.reset();
 const make=(href:string)=>({key:"/|"+href,href,kind:"external" as const,label:"Book a Consultation",scope:"page",elementKey:"0.1",requestIds:[],status:null});
 let link: import("../submitWalkthrough").ReviewLink=make("https://gooogle.com");const group={page:{name:"Homepage",path:"/"},label:"Homepage",links:[link]};
 for(const href of ["https://google.com","https://google.com/maps","https://google.com/final"]){walk.editLink({link,group,rows:[],fingerprint:"own"});walk.savedLink("/",make(href));link=walk.get().savedReviewLinks[0].link;expect(walk.get().savedReviewLinks).toHaveLength(1);expect(link.key).toBe("/|page|0.1");}
 expect(walk.get().verificationOpened).toEqual({});expect(walk.get().linkTicked).toEqual([]);walk.reset();
});
