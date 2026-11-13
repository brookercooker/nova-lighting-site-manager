import { useEffect, useMemo } from "react";
import { comparedReviewLinks, publishedComparison } from "./publishedLinkComparison";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CONTENT_SAVED } from "./contentSavedEvent";
import { reviewLinkIdentity, sameReviewLink, stableReviewRows } from "./reviewLinkIdentity";
import { useWalk } from "./submitWalkthroughStore";
import { useDesignChat } from "./DesignChatContext";
import { addSharedChromeRows, mergeSharedReviewLinks, stableReviewEdits, type SharedReviewObject } from "./sharedReviewLinks";
import { liveSiteBase, loadNetLinks, netReviewLinks, requestFrameInventory, requestInventory, retainInventoryMetadata, type InventoryLink } from "./linkInventory";
import { shownPreviewFrame } from "./previewNavigate";
import { publicPreviewBase, publicPreviewPage } from "./publicPreviewUrl";
import { supabase } from "@/prototype/client";
import { codePagePaths, loadSiteManifest } from "../siteManifest";
import { RELAY, relayHeaders, type RelayState } from "./helper";
import { changeFingerprint, normPath, changedPages, countHandEdits, dropRevertedHandEdits, mergeReviewLinks, parseReviewLinks, parseReviewPages, relayChangedPages, type ChangedRow, type ManagerPage, type PageRef, type ReviewLinks, type ReviewPages } from "./submitWalkthrough";

export type LinksResult = { status: "loading" } | { status: "failed" } | ({ status: "ok" } & ReviewLinks);
export type WalkthroughData = { rows: ChangedRow[]; pages: ManagerPage[]; links: LinksResult; comparisonUnavailable?: boolean; inventoryLinks?: InventoryLink[]; inventoryUnavailable?: boolean; retryInventory?: () => void; pagesStatus?: "loading" | "failed" | "ok" };

/** Pages using each shared object, from the same object_page_usages table the Objects tab's Used On reads. */
async function fetchObjectPages(names: string[]): Promise<{ usages: Record<string, PageRef[]>; shared: SharedReviewObject[] }> {
  const { data: registry, error: registryError } = await (supabase as any).from("object_registry").select("id,name,component_key,inline_edits,content").is("archived_at", null);
  if (registryError) throw registryError;
  const matches = (registry ?? []).filter((r: any) => names.includes(r.name) || names.includes(r.component_key) || Object.keys(stableReviewEdits(r.inline_edits) as object).length > 0);
  if (!matches.length) return { usages: {}, shared: [] };
  const { data, error } = await (supabase as any).from("object_page_usages")
    .select("object_registry_id, pages:page_id(name,path,archived_at)")
    .in("object_registry_id", matches.map((r: any) => r.id));
  if (error) throw error;
  const out: Record<string, PageRef[]> = {};
  for (const row of data ?? []) {
    const object = matches.find((r: any) => r.id === row.object_registry_id); const p = row.pages;
    if (!object || !p || p.archived_at || typeof p.path !== "string") continue;
    for (const name of names.filter((n) => n === object.name || n === object.component_key))
      (out[name] ??= []).push({ name: p.name || p.path, path: p.path, sharedChange: { inlineEdits: object.inline_edits, content: object.content } });
  }
  const shared = matches.map((r: any) => ({ id: r.id, name: r.name, componentKey: r.component_key, inlineEdits: r.inline_edits, content: r.content, pages: (data ?? []).filter((u: any) => u.object_registry_id === r.id && u.pages && !u.pages.archived_at && typeof u.pages.path === "string").map((u: any) => ({ name: u.pages.name, path: u.pages.path })) }));
  return { usages: out, shared };
}
async function fetchManagerPages(): Promise<ManagerPage[]> {
  const { data, error } = await (supabase as any).from("pages").select("name,path,build_status,status,thumbnail_url,archived_at,inline_edits,content").is("archived_at", null);
  if (error) throw error;
  const list: ManagerPage[] = (data ?? []).map((p: any) => ({ name: p.name || p.path, path: p.path, build_status: p.build_status, status: p.status, thumbnail_url: p.thumbnail_url, handEdits: countHandEdits(p.inline_edits), inlineEdits: p.inline_edits, content: p.content }));
  // Coded pages from the public manifest are live even when they were never registered as Manager rows.
  try {
    const known = new Set(list.map((p) => p.path));
    for (const path of codePagePaths(await loadSiteManifest())) if (!known.has(path)) list.push({ name: path, path, build_status: "ready" });
  } catch { /* Registered pages still decide. */ }
  return list;
}
async function fetchReviewLinks(): Promise<ReviewLinks> {
  const res = await fetch(`${RELAY}/api/review-links`, { cache: "no-store", headers: await relayHeaders() });
  if (!res.ok) throw new Error(String(res.status));
  const parsed = parseReviewLinks(await res.json().catch(() => null));
  if (!parsed) throw new Error("unusable");
  return parsed;
}

/** Only deployment absence or a network failure permits the legacy derivation. */
export async function fetchReviewPages(): Promise<ReviewPages | null> {
  const headers = await relayHeaders();
  let res: Response;
  try { res = await fetch(`${RELAY}/api/review-pages`, { cache: "no-store", headers }); }
  catch { return null; }
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(String(res.status));
  const parsed = parseReviewPages(await res.json());
  if (!parsed) throw new Error("unusable");
  return parsed;
}

/** Everything the walkthrough lists; re-reads when the draft's requests change. */
export function useWalkthroughData(state: RelayState | null, enabled: boolean): WalkthroughData {
  const walkState = useWalk();
  const { preview } = useDesignChat();
  const shownUrl = preview?.frames.find(frame => frame.id === preview.shownId)?.url ?? preview?.frames.at(-1)?.url;
  // Page navigation is not a new inventory: keep the signed site base as its identity.
  const embed = useMemo(() => { try { return publicPreviewBase(shownUrl); } catch { return undefined; } }, [shownUrl]);
  const requests = state?.draft?.requests;
  const sig = changeFingerprint(requests ?? []) + ":" + (state?.previewVersion ?? 0) + ":" + (walkState.reviewSession ?? 0);
  const reviewPages = useQuery({ refetchOnWindowFocus: false, refetchOnReconnect: false, queryKey: ["walkthrough", "review-pages", sig], queryFn: fetchReviewPages, enabled, retry: false, staleTime: Infinity });
  const names = useMemo(() => [...new Set(reviewPages.data
    ? [...reviewPages.data.components, ...reviewPages.data.objects].map((p) => p.name)
    : reviewPages.data === null ? (requests ?? []).flatMap((r) => r.objects ?? []) : [])].sort(), [requests, reviewPages.data]);
  const objects = useQuery({ refetchOnWindowFocus: false, refetchOnReconnect: false, queryKey: ["walkthrough", "object-pages", names, sig], queryFn: () => fetchObjectPages(names), enabled, staleTime: Infinity });
  const pages = useQuery({ refetchOnWindowFocus: false, refetchOnReconnect: false, queryKey: ["walkthrough", "pages", sig], queryFn: fetchManagerPages, enabled, staleTime: Infinity });
  const links = useQuery({ refetchOnWindowFocus: false, refetchOnReconnect: false, queryKey: ["walkthrough", "links", sig], queryFn: fetchReviewLinks, enabled, retry: false, staleTime: Infinity });
  const rows = useMemo(() => {
    const authoritative = reviewPages.data;
    const active = (piece: { name: string; requestIds: string[] }) => {
      const object = objects.data?.shared.find(o => o.name === piece.name || o.componentKey === piece.name);
      const edits = object ? Object.keys(stableReviewEdits(object.inlineEdits) as object).length : undefined;
      const sources = (requests ?? []).filter(r => piece.requestIds.includes(r.id));
      // Empty overrides prove a hand-edit restore only when every recorded request is a hand edit.
      return !(edits === 0 && sources.length === piece.requestIds.length && sources.length > 0 && sources.every(r => r.source === "content"));
    };
    const filtered = authoritative ? { ...authoritative, components: authoritative.components.filter(active), objects: authoritative.objects.filter(active) } : null;
    const derived = filtered ? relayChangedPages(filtered, pages.data ?? [], objects.data?.usages ?? {}, requests) : authoritative === null ? changedPages(requests, objects.data?.usages ?? {}) : [];
    return addSharedChromeRows(dropRevertedHandEdits(derived, pages.data ?? []), objects.data?.shared ?? [], pages.data ?? [], filtered ? [...filtered.components, ...filtered.objects].map(piece => piece.name) : []);
  }, [reviewPages.data, requests, objects.data, pages.data]);
  // Saved hand edits (Manual Edit Mode, Change This Link) re-read every list, so new destinations appear straight away.
  const client = useQueryClient();
  useEffect(() => {
    if (!enabled) return;
    const on = () => { void client.invalidateQueries({ queryKey: ["walkthrough"] }); };
    window.addEventListener(CONTENT_SAVED, on);
    return () => window.removeEventListener(CONTENT_SAVED, on);
  }, [enabled, client]);
  const handPaths = useMemo(() => new Set(reviewPages.data ? reviewPages.data.rows.filter(r => r.how.includes("content")).map(r => normPath(r.path))
    : (requests ?? []).filter(r => r.source === "content").flatMap(r => (r.pages ?? (r.page ? [r.page] : [])).map(p => normPath(p.path)))), [reviewPages.data, requests]);
  // True draft-vs-live comparison when the live site is configured and the frames answer link-inventory; otherwise today's list.
  const live = liveSiteBase() ?? liveSiteBase(state?.liveUrl);
  const changedPaths = rows.map(r => r.page?.path).filter((p): p is string => !!p).sort();
  const inventory = useQuery({ refetchOnWindowFocus: false, refetchOnReconnect: false, queryKey: ["walkthrough", "inventory", sig, changedPaths, live, embed], queryFn: () => loadNetLinks(changedPaths, live, requestInventory, shownPreviewFrame(), embed), enabled: enabled && changedPaths.length > 0, retry: false, staleTime: Infinity });
  const merged = useMemo(() => links.data ? mergeSharedReviewLinks(netReviewLinks(mergeReviewLinks(links.data, pages.data ?? [], handPaths), inventory.data ?? {}, pages.data ?? []), objects.data?.shared ?? [], pages.data ?? []) : null, [links.data, pages.data, handPaths, inventory.data, objects.data]);
  const sharedPaths = [...new Set(merged?.groups.map(group => group.page?.path).filter((path): path is string => !!path) ?? [])].sort();
  const sharedLabels = useQuery({ refetchOnWindowFocus: false, refetchOnReconnect: false, queryKey: ["walkthrough", "shared-labels", sig, sharedPaths, embed], enabled: enabled && sharedPaths.length > 0, staleTime: Infinity, retry: false, queryFn: async () => {
    const frame = shownPreviewFrame();
    let base: string;
    try { base = publicPreviewBase(embed ?? frame?.src); } catch { return { links: [] as (InventoryLink & { inventoryPath: string })[], unavailable: true }; }
    const inventories = await Promise.all(sharedPaths.map(async path => {
      const url = publicPreviewPage(base, path);
      const fresh = (frame ? await requestFrameInventory(frame, url) : null) ?? await requestInventory(url);
      const cacheKey = ["review-inventory-cache", new URL(base).origin, normPath(path)];
      const retained = retainInventoryMetadata(fresh, client.getQueryData<import("./linkInventory").Inventory>(cacheKey));
      if (fresh) client.setQueryData(cacheKey, retained);
      return { fresh: !!fresh, inventory: retained };
    }));
    return { links: inventories.flatMap(({ inventory: item }) => item ? item.links.map(link => ({ ...link, inventoryPath: item.path })) : []), unavailable: inventories.some(item => !item.fresh) };
  } });
  const labelled = merged ? enrichReviewLinks(merged, sharedLabels.data?.links ?? []) : null;
  const siteInventory = useQuery({ refetchOnWindowFocus: false, refetchOnReconnect: false, queryKey: ["walkthrough", "site-hosts", pages.data?.map(p => p.path)], enabled: enabled && walkState.step === "links" && !!pages.data?.length, staleTime: 300_000, retry: false, queryFn: async () => {
    let base: string; try { base = publicPreviewBase(shownPreviewFrame()?.src); } catch { return []; }
    const queue = [...new Set((pages.data ?? []).map(p => p.path))];
    const all: InventoryLink[] = [];
    await Promise.all(Array.from({ length: 3 }, async () => {
      while (queue.length) { const path = queue.shift(); if (!path) continue; const inventory = await requestInventory(publicPreviewPage(base, path)); if (inventory) all.push(...inventory.links.map(l => ({ ...l, inventoryPath: normPath(inventory.path) }))); }
    }));
    return all;
  } });
  const sourcePending = reviewPages.isPending || reviewPages.isFetching || objects.isPending || objects.isFetching || pages.isPending || pages.isFetching;
  const inventoryPending = changedPaths.length > 0 && enabled && (inventory.isPending || inventory.isFetching);
  const inventoryIncomplete = changedPaths.some(path => !(normPath(path) in (inventory.data ?? {})));
  const metadataPending = enabled && sharedPaths.length > 0 && (sharedLabels.isPending || sharedLabels.isFetching);
  const linkResult: LinksResult = sourcePending || inventoryPending || metadataPending ? { status: "loading" } : links.isError || objects.isError || reviewPages.isError || inventory.isError || inventoryIncomplete ? { status: "failed" } : labelled && !links.isFetching ? { status: "ok", ...labelled } : { status: "loading" };
  const pagesStatus = reviewPages.isError || objects.isError || pages.isError ? "failed" : reviewPages.isPending || objects.isLoading || pages.isLoading ? "loading" : "ok";
  const fingerprintedRows = rows.map((row) => {
    const path = row.page?.path;
    const authoritative = reviewPages.data;
    const ids = authoritative ? [...authoritative.rows.filter(p => path && normPath(p.path) === normPath(path)).flatMap(p => p.requestIds),
      ...[...authoritative.components, ...authoritative.objects].filter(piece => (objects.data?.usages[piece.name] ?? []).some(p => path && normPath(p.path) === normPath(path))).flatMap(piece => piece.requestIds),
      ...(!path ? authoritative.sitewide.requestIds : [])] : (requests ?? []).filter(r => !path || (r.pages ?? (r.page ? [r.page] : [])).some(p => normPath(p.path) === normPath(path)) || (r.objects ?? []).some(n => (objects.data?.usages[n] ?? []).some(p => normPath(p.path) === normPath(path)))).map(r => r.id);
    const page = pages.data?.find(p => path && normPath(p.path) === normPath(path));
    const shared = (objects.data?.shared ?? []).filter(o => row.shared ? o.id === row.shared.id : path && o.pages.some(p => normPath(p.path) === normPath(path))).map(o => ({ id: o.id, edits: stableReviewEdits(o.inlineEdits), content: o.content ?? null })).sort((a,b) => a.id.localeCompare(b.id));
    return { ...row, fingerprint: changeFingerprint({ ids: [...new Set(ids)].sort(), requests: (requests ?? []).filter(r => ids.includes(r.id)).map(r => ({ id: r.id, sha: r.sha, request: r.request, details: r.details })).sort((a,b) => a.id.localeCompare(b.id)), edits: stableReviewEdits(page?.inlineEdits), content: page?.content ?? null, shared, files: !path ? authoritative?.sitewide.files : undefined }) };
  });
  const comparable = linkResult.status === "ok" ? enrichReviewLinks(mergeSavedReviewLinks(linkResult, walkState.savedReviewLinks, pages.data ?? [], inventory.data ?? {}), sharedLabels.data?.links ?? []) : null;
  const withSaved: LinksResult = comparable ? { ...stableReviewRows(comparedReviewLinks(comparable)), status: "ok" } : linkResult;
  return { comparisonUnavailable: comparable?.groups.some(g => g.links.some(l => publishedComparison(l) === "unknown")), inventoryLinks: [...(siteInventory.data ?? []), ...(sharedLabels.data?.links ?? [])], inventoryUnavailable: sharedLabels.data?.unavailable || sharedLabels.isError, retryInventory: () => { void sharedLabels.refetch(); void inventory.refetch(); if (links.isError) void links.refetch(); if (reviewPages.isError) void reviewPages.refetch(); if (objects.isError) void objects.refetch(); if (pages.isError) void pages.refetch(); }, rows: fingerprintedRows, pages: pages.data ?? [], links: withSaved, pagesStatus: pagesStatus === "ok" && (pages.isFetching || reviewPages.isFetching || objects.isFetching) ? "loading" : pagesStatus };
}

/** Adopt only unique authoritative identities; duplicate destinations never authorize a guess. */
export function enrichReviewLinks(base: ReviewLinks, inventory: InventoryLink[]): ReviewLinks {
  return { ...base, groups: base.groups.map(group => ({ ...group, links: group.links.map(link => {
    const candidates = inventory.filter(item => (group.shared ? item.scope === `object:${group.shared.id}` : normPath(item.inventoryPath ?? "") === normPath(group.page?.path ?? "/")) && (link.elementKey ? item.key === link.elementKey.replace(/^link:/, "") && item.scope === (link.scope ?? "page") && item.inventoryIndex === link.inventoryIndex : item.href === link.href));
    const wording = link.visibleText || link.label || link.ariaLabel;
    const named = candidates.filter(item => wording && [item.visibleText, item.label, item.ariaLabel].includes(wording));
    const matches = link.elementKey ? candidates : named.length ? named : candidates;
    if (matches.length !== 1) return link;
    const item = matches[0];
    return { ...link, elementKey: item.key, scope: item.scope, inventoryIndex: item.inventoryIndex, publishedHref: link.publishedHref !== undefined ? link.publishedHref : item.publishedHref, originalHref: link.originalHref ?? item.originalHref, label: item.label || link.label, ariaLabel: item.ariaLabel || link.ariaLabel, visibleText: item.visibleText || link.visibleText, image: item.image || link.image };
  }) })) };
}
/** Only a supplied original destination proves a restore; absent baseline stays visible. */
export function dropOriginalDestinations(base: ReviewLinks): ReviewLinks {
  return { ...base, groups: base.groups.map(g => ({ ...g, links: g.links.filter(l => !l.originalHref || l.href !== l.originalHref) })).filter(g => g.links.length) };
}

/** Saved rows bridge relay lag only; an authoritative net inventory wins, including an empty net result. */
export function mergeSavedReviewLinks(base: ReviewLinks, saved: { path: string; link: import("./submitWalkthrough").ReviewLink; replacedKeys?: string[] }[], pages: ManagerPage[], nets: Record<string, unknown>) {
  const groups = base.groups.map(g => ({ ...g, links: [...g.links] }));
  for (const x of saved) {
    if (normPath(x.path) in nets) continue;
    let g = groups.find(g => x.link.scope?.startsWith("object:") ? `object:${g.shared?.id}` === x.link.scope : g.page && normPath(g.page.path) === normPath(x.path));
    if (!g) { const page = pages.find(p => normPath(p.path) === normPath(x.path)); g = { page: { path: x.path, name: page?.name ?? x.path }, label: page?.name ?? x.path, links: [] }; groups.push(g); }
    const matches = (l: import("./submitWalkthrough").ReviewLink) => sameReviewLink(l, x.link, x.path) || !l.elementKey && !x.link.elementKey && !!x.replacedKeys?.includes(l.key);
    const at = g.links.findIndex(matches);
    const prior = at >= 0 ? g.links[at] : undefined;
    const next = { ...prior, ...x.link, originalHref: x.link.originalHref ?? prior?.originalHref, label: x.link.label || prior?.label || null, visibleText: x.link.visibleText || prior?.visibleText, image: x.link.image || prior?.image };
    if (at >= 0) g.links = g.links.flatMap((l, i) => i === at ? [next] : matches(l) ? [] : [l]); else g.links.push(next);
  }
  return { ...base, groups };
}
