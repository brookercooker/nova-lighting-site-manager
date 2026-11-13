import { parseBlocks } from "@/components/PageBlocks";
import type { ManagerPage } from "./submitWalkthrough";

/** Only saved image blocks or the stored page preview; never crawl a destination. */
export function pagePeekImage(page: ManagerPage): string | null {
  const image = parseBlocks(page.content).find(b => b.type === "image");
  const source = image?.type === "image" ? image.url : page.thumbnail_url;
  return source && (/^https:\/\//i.test(source) || /^\/(?!\/)/.test(source)) ? source : null;
}