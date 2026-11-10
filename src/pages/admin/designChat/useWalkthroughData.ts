import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/prototype/client";
import { codePagePaths, loadSiteManifest } from "../siteManifest";
import { RELAY, relayHeaders, type RelayState } from "./helper";
import { changedPages, countHandEdits, dropRevertedHandEdits, parseReviewLinks, parseReviewPages, relayChangedPages, type ChangedRow, type ManagerPage, type PageRef, type ReviewLinks, type ReviewPages } from "./submitWalkthrough";

export type LinksResult = { status: "loading" } | { status: "failed" } | ({ status: "ok" } & ReviewLinks);
export type WalkthroughData = { rows: ChangedRow[]; pages: ManagerPage[]; links: LinksResult; pagesStatus?: "loading" | "failed" | "ok" };

/** Pages using each shared object, from the same object_page_usages table the Objects tab's Used On reads. */
async function fetchObjectPages(names: string[]): Promise<Record<string, PageRef[]>> {
  if (!names.length) return {};
  const { data: registry, error: registryError } = await (supabase as any).from("object_registry").select("id,name,component_key").is("archived_at", null);
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
      (out[name] ??= []).push({ name: p.name || p.path, path: p.path });
  }
  return out;
}
async function fetchManagerPages(): Promise<ManagerPage[]> {
  const { data, error } = await (supabase as any).from("pages").select("name,path,build_status,archived_at,inline_edits").is("archived_at", null);
  if (error) throw error;
  const list: ManagerPage[] = (data ?? []).map((p: any) => ({ name: p.name || p.path, path: p.path, build_status: p.build_status, handEdits: countHandEdits(p.inline_edits) }));
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
  const requests = state?.draft?.requests;
  const sig = (requests ?? []).map((r) => `${r.id}:${r.sha ?? ""}:${r.builtAt ?? ""}`).join(",") + ":" + (state?.previewVersion ?? 0);
  const reviewPages = useQuery({ queryKey: ["walkthrough", "review-pages", sig], queryFn: fetchReviewPages, enabled, retry: false, staleTime: 0, refetchOnMount: "always" });
  const names = useMemo(() => [...new Set(reviewPages.data
    ? [...reviewPages.data.components, ...reviewPages.data.objects].map((p) => p.name)
    : reviewPages.data === null ? (requests ?? []).flatMap((r) => r.objects ?? []) : [])].sort(), [requests, reviewPages.data]);
  const objects = useQuery({ queryKey: ["walkthrough", "object-pages", names], queryFn: () => fetchObjectPages(names), enabled: enabled && names.length > 0, staleTime: 15_000 });
  const pages = useQuery({ queryKey: ["walkthrough", "pages"], queryFn: fetchManagerPages, enabled, staleTime: 15_000 });
  const links = useQuery({ queryKey: ["walkthrough", "links", sig], queryFn: fetchReviewLinks, enabled, retry: false, staleTime: 30_000 });
  const rows = useMemo(() => dropRevertedHandEdits(reviewPages.data ? relayChangedPages(reviewPages.data, pages.data ?? [], objects.data ?? {}, requests)
    : reviewPages.data === null ? changedPages(requests, objects.data ?? {}) : [], pages.data ?? []), [reviewPages.data, requests, objects.data, pages.data]);
  const linkResult: LinksResult = links.isError ? { status: "failed" } : links.data ? { status: "ok", ...links.data } : { status: "loading" };
  const pagesStatus = reviewPages.isError || objects.isError ? "failed" : reviewPages.isPending || objects.isLoading || pages.isLoading ? "loading" : "ok";
  return { rows, pages: pages.data ?? [], links: linkResult, pagesStatus };
}
