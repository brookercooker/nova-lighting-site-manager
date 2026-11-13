import { publicLinkAddress } from "../linkDisplay";
import type { LinkClick } from "./linkCheck";

/** A blank script-owned tab allows accurate blocker detection; sever opener before loading any destination. */
export function openReviewDestination(click: LinkClick, preservePreviewCredentials = false): boolean {
  let url: URL;
  try {
    url = new URL(preservePreviewCredentials ? click.href : publicLinkAddress(click.href));
    if (!["https:", "http:", "mailto:", "tel:"].includes(url.protocol) || url.username || url.password) return false;
  } catch { return false; }
  const tab = window.open("about:blank", "_blank");
  if (!tab) return false;
  try {
    tab.opener = null;
    const policy = tab.document.createElement("meta");
    policy.name = "referrer"; policy.content = "no-referrer"; tab.document.head.appendChild(policy);
    // Match the tile's noopener/noreferrer contract, including a no-referrer navigation.
    const anchor = tab.document.createElement("a");
    anchor.href = url.href; anchor.rel = "noopener noreferrer"; anchor.referrerPolicy = "no-referrer";
    tab.document.body.appendChild(anchor); anchor.click();
    return true;
  } catch { tab.close(); return false; }
}