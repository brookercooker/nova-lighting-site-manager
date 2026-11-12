import { useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CONTENT_SAVED } from "./contentSavedEvent";
import { useWalk } from "./submitWalkthroughStore";
import { liveSiteBase, loadNetLinks, netReviewLinks } from "./linkInventory";
import { supabase } from "@/prototype/client";
import { codePagePaths, loadSiteManifest } from "../siteManifest";
import { RELAY, relayHeaders, type RelayState } from "./helper";
import { changeFingerprint, normPath, changedPages, countHandEdits, dropRevertedHandEdits, mergeReviewLinks, parseReviewLinks, parseReviewPages, relayChangedPages, type ChangedRow, type ManagerPage, type PageRef, type ReviewLinks, type ReviewPages } from "./submitWalkthrough";

export type LinksResult = { status: "loading" } | { status: "failed" } | ({ status: "ok" } & ReviewLinks);
export type WalkthroughData = { rows: ChangedRow[]; pages: ManagerPage[]; links: LinksResult; pagesStatus?: "loading" | "failed" | "ok" };

/** Pages using each shared object, from the same object_page_usages table the Objects tab's Used On reads. */
async function fetchObjectPages(names: string[]): Promise<Record<string, PageRef[]>> {
  if (!names.length) return {};
  const { data: registry, error: registryError } = await (supabase as any).from("object_registry").select("id,name,component_key,inline_edits,content").is("archived_at", null);
  if (registryError) throw registryError;
  const matches = (registry ?? []).filter((r: any) => names.includes(r.name) || names.includes(r.component_key));
  if (!matches.length) return {};
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
  return out;
}
async function fetchManagerPages(): Promise<ManagerPage[]> {
  const { data, error } = await (supabase as any).from("pages").select("name,path,build_status,archived_at,inline_edits,content").is("archived_at", null);
  if (error) throw error;
  const list: ManagerPage[] = (data ?? []).map((p: any) => ({ name: p.name || p.path, path: p.path, build_status: p.build_status, handEdits: countHandEdits(p.inline_edits), inlineEdits: p.inline_edits, content: p.content }));
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
  const requests = state?.draft?.requests;
  const sig = changeFingerprint(requests ?? []) + ":" + (state?.previewVersion ?? 0);
  const reviewPages = useQuery({ queryKey: ["walkthrough", "review-pages", sig], queryFn: fetchReviewPages, enabled, retry: false, staleTime: 0, refetchOnMount: "always" });
  const names = useMemo(() => [...new Set(reviewPages.data
    ? [...reviewPages.data.components, ...reviewPages.data.objects].map((p) => p.name)
    : reviewPages.data === null ? (requests ?? []).flatMap((r) => r.objects ?? []) : [])].sort(), [requests, reviewPages.data]);
  const objects = useQuery({ queryKey: ["walkthrough", "object-pages", names, sig], queryFn: () => fetchObjectPages(names), enabled: enabled && names.length > 0, staleTime: 0, refetchOnMount: "always" });
  const pages = useQuery({ queryKey: ["walkthrough", "pages", sig], queryFn: fetchManagerPages, enabled, staleTime: 0, refetchOnMount: "always" });
  const links = useQuery({ queryKey: ["walkthrough", "links", sig], queryFn: fetchReviewLinks, enabled, retry: false, staleTime: 0, refetchOnMount: "always" });
  const rows = useMemo(() => dropRevertedHandEdits(reviewPages.data ? relayChangedPages(reviewPages.data, pages.data ?? [], objects.data ?? {}, requests)
    : reviewPages.data === null ? changedPages(requests, objects.data ?? {}) : [], pages.data ?? []), [reviewPages.data, requests, objects.data, pages.data]);
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
  const live = liveSiteBase();
  const changedPaths = rows.map(r => r.page?.path).filter((p): p is string => !!p).sort();
  const inventory = useQuery({ queryKey: ["walkthrough", "inventory", sig, changedPaths], queryFn: () => loadNetLinks(changedPaths, live), enabled: enabled && !!live && changedPaths.length > 0, retry: false, staleTime: 0, refetchOnMount: "always" });
  const merged = useMemo(() => links.data ? netReviewLinks(mergeReviewLinks(links.data, pages.data ?? [], handPaths), inventory.data ?? {}, pages.data ?? []) : null, [links.data, pages.data, handPaths, inventory.data]);
  const inventoryPending = !!live && changedPaths.length > 0 && enabled && inventory.isFetching;
  const linkResult: LinksResult = links.isError ? { status: "failed" } : merged && !links.isFetching && !pages.isFetching && !inventoryPending ? { status: "ok", ...merged } : { status: "loading" };
  const pagesStatus = reviewPages.isError || objects.isError || pages.isError ? "failed" : reviewPages.isPending || objects.isLoading || pages.isLoading ? "loading" : "ok";
  const fingerprintedRows = rows.map((row) => {
    const path = row.page?.path;
    const authoritative = reviewPages.data;
    const ids = authoritative ? [...authoritative.rows.filter(p => path && normPath(p.path) === normPath(path)).flatMap(p => p.requestIds),
      ...[...authoritative.components, ...authoritative.objects].filter(piece => (objects.data?.[piece.name] ?? []).some(p => path && normPath(p.path) === normPath(path))).flatMap(piece => piece.requestIds),
      ...(!path ? authoritative.sitewide.requestIds : [])] : (requests ?? []).filter(r => !path || (r.pages ?? (r.page ? [r.page] : [])).some(p => normPath(p.path) === normPath(path)) || (r.objects ?? []).some(n => (objects.data?.[n] ?? []).some(p => normPath(p.path) === normPath(path)))).map(r => r.id);
    const page = pages.data?.find(p => path && normPath(p.path) === normPath(path));
    const shared = names.map(name => ({ name, changes: (objects.data?.[name] ?? []).filter(p => path && normPath(p.path) === normPath(path)).map(p => p.sharedChange) })).filter(p => p.changes.length);
    return { ...row, fingerprint: changeFingerprint({ ids: [...new Set(ids)].sort(), requests: (requests ?? []).filter(r => ids.includes(r.id)).map(r => ({ id: r.id, at: r.at, sha: r.sha, builtAt: r.builtAt, request: r.request, details: r.details })).sort((a,b) => a.id.localeCompare(b.id)), edits: page?.inlineEdits, content: page?.content, shared, files: !path ? authoritative?.sitewide.files : undefined }) };
  });
  const withSaved: LinksResult = linkResult.status === "ok" ? { ...mergeSavedReviewLinks(linkResult, walkState.savedReviewLinks, pages.data ?? [], inventory.data ?? {}), status: "ok" } : linkResult;
  return { rows: fingerprintedRows, pages: pages.data ?? [], links: withSaved, pagesStatus: pagesStatus === "ok" && (pages.isFetching || reviewPages.isFetching || objects.isFetching) ? "loading" : pagesStatus };
}

/** Saved rows bridge relay lag only; an authoritative net inventory wins, including an empty net result. */
export function mergeSavedReviewLinks(base: ReviewLinks, saved: { path: string; link: import("./submitWalkthrough").ReviewLink }[], pages: ManagerPage[], nets: Record<string, unknown>) {
  const groups = base.groups.map(g => ({ ...g, links: [...g.links] }));
  for (const x of saved) {
    if (normPath(x.path) in nets) continue;
    let g = groups.find(g => g.links.some(l => l.key === x.link.key) || (x.link.key.startsWith("|") ? !g.page : g.page && normPath(g.page.path) === normPath(x.path)));
    if (!g) { const page = pages.find(p => normPath(p.path) === normPath(x.path)); g = { page: { path: x.path, name: page?.name ?? x.path }, label: page?.name ?? x.path, links: [] }; groups.push(g); }
    if (!g.links.some(l => l.key === x.link.key)) g.links.push(x.link);
  }
  return { ...base, groups };
}
