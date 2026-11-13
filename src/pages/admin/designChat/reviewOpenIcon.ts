import { openReviewDestination } from "./openReviewDestination";
import { walk } from "./submitWalkthroughStore";

/** Cancel native/replayed navigation before synchronously opening an isolated tab. */
export function openReviewIcon(event: { preventDefault: () => void; stopPropagation: () => void }, href: string, onOpened?: () => void) {
  event.preventDefault(); event.stopPropagation();
  const opened = openReviewDestination({ href, raw: href, path: "/", kind: "external", label: null }, true);
  if (opened) { walk.update(w => ({ ...w, linkNote: null })); onOpened?.(); }
  else walk.update(w => ({ ...w, linkNote: "Your browser blocked the new tab. Use the open icon on the tile." }));
  return opened;
}