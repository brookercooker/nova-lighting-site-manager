import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/prototype/client";
import { codePagePaths, loadSiteManifest } from "../siteManifest";
import { RELAY, relayHeaders, type RelayState } from "./helper";
import { changedPages, parseReviewLinks, type ChangedRow, type ManagerPage, type PageRef, type ReviewLinks } from "./submitWalkthrough";

export type LinksResult = { status: "loading" } | { status: "failed" } | ({ status: "ok" } & ReviewLinks);
export type WalkthroughData = { rows: ChangedRow[]; pages: ManagerPage[]; links: LinksResult };

/** Pages using each shared object, from the same object_page_usages table the Objects tab's Used On reads. */
async function fetchObjectPages(names: string[]): Promise<Record<string, PageRef[]>> {
  if (!names.length) return {};
  const { data, error } = await (supabase as any).from("object_page_usages")
    .select("object_registry:object_registry_id!inner(name), pages:page_id(name,path,archived_at)")
    .in("object_registry.name", names);
  if (error) throw error;
  const out: Record<string, PageRef[]> = {};
  for (const row of data ?? []) {
    const name = row.object_registry?.name; const p = row.pages;
    if (!name || !p || p.archived_at || typeof p.path !== "string") continue;
    (out[name] ??= []).push({ name: p.name || p.path, path: p.path });
  }
  return out;
}
async function fetchManagerPages(): Promise<ManagerPage[]> {
  const { data, error } = await (supabase as any).from("pages").select("name,path,build_status,archived_at").is("archived_at", null);
  if (error) throw error;
  const list: ManagerPage[] = (data ?? []).map((p: any) => ({ name: p.name || p.path, path: p.path, build_status: p.build_status }));
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

/** Everything the walkthrough lists; re-reads when the draft's requests change. */
export function useWalkthroughData(state: RelayState | null, enabled: boolean): WalkthroughData {
  const requests = state?.draft?.requests;
  const names = useMemo(() => [...new Set((requests ?? []).flatMap((r) => (Array.isArray(r.objects) ? r.objects : [])).filter((n) => typeof n === "string" && n.trim()))].sort(), [requests]);
  const sig = (requests ?? []).map((r) => r.id).join(",");
  const objects = useQuery({ queryKey: ["walkthrough", "object-pages", names], queryFn: () => fetchObjectPages(names), enabled: enabled && names.length > 0, staleTime: 15_000 });
  const pages = useQuery({ queryKey: ["walkthrough", "pages"], queryFn: fetchManagerPages, enabled, staleTime: 15_000 });
  const links = useQuery({ queryKey: ["walkthrough", "links", sig], queryFn: fetchReviewLinks, enabled, retry: false, staleTime: 30_000 });
  const rows = useMemo(() => changedPages(requests, objects.data ?? {}), [requests, objects.data]);
  const linkResult: LinksResult = links.isError ? { status: "failed" } : links.data ? { status: "ok", ...links.data } : { status: "loading" };
  return { rows, pages: pages.data ?? [], links: linkResult };
}
