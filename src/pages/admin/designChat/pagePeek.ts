import { parseBlocks } from "@/components/PageBlocks";
import type { ManagerPage } from "./submitWalkthrough";

/** Only saved image blocks or the stored page preview; never crawl a destination. */
export function pagePeekImage(page: ManagerPage): string | null {
  const sources = [...parseBlocks(page.content).filter(b => b.type === "image").map(b => b.type === "image" ? b.url : null), page.thumbnail_url];
  return sources.find(source => source && (/^https:\/\//i.test(source) || /^\/(?!\/)/.test(source))) ?? null;
}