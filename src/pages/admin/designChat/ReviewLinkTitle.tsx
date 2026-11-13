import type { ManagerPage, ReviewLink } from "./submitWalkthrough";
import { linkText } from "./linkCheck";
import { publicLinkAddress } from "../linkDisplay";

export function ReviewLinkTitle({ link, pages }: { link: ReviewLink; pages: ManagerPage[] }) {
  const title = reviewTileTitle(link, pages);
  return <div className="flex min-w-0 items-center gap-2">
    <p className="min-w-0 flex-1 break-words text-sm font-medium">{title}</p>
  </div>;
}
export function reviewTileTitle(link: ReviewLink, pages: ManagerPage[] = []): string {
  return link.image ? "Image" : publicLinkAddress((link.visibleText || link.label || link.ariaLabel || linkText(link, pages)).replace(/\s+/g, " ").trim());
}