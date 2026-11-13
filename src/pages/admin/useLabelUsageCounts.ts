import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/prototype/client";
import type { LabelScope } from "./useAllLabels";
const tables: Record<LabelScope, [string, string]> = { objects: ["object_registry", "labels"], static: ["pages", "tags"], landing: ["pages", "tags"], images: ["images", "tags"], videos: ["videos", "tags"], links: ["link_audit_rows", "tags"] };
export function useLabelUsageCounts(scope: LabelScope) {
  return useQuery({ queryKey: ["admin", "label-usage", scope], staleTime: 0, queryFn: async () => {
    const [table, column] = tables[scope]; let query = (supabase as any).from(table).select(column);
    if (scope === "static" || scope === "landing") query = query.eq("page_type", scope);
    const { data, error } = await query; if (error) throw error;
    const counts: Record<string, number> = {}; for (const item of data ?? []) for (const path of new Set<string>(item[column] ?? [])) counts[path] = (counts[path] ?? 0) + 1;
    return counts;
  } });
}