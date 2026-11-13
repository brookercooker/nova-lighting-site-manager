import { useState } from "react";
import type { ManagerPage, ReviewLink } from "./submitWalkthrough";
import { linkText } from "./linkCheck";
import { publicLinkAddress } from "../linkDisplay";

export function ReviewLinkTitle({ link, pages }: { link: ReviewLink; pages: ManagerPage[] }) {
  const [failed, setFailed] = useState(false);
  const title = publicLinkAddress(linkText(link, pages));
  const src = link.image?.src;
  const thumbnail = !failed && src && /^https:\/\//i.test(src);
  return <div className="flex min-w-0 items-center gap-2">
    {thumbnail && <img src={src} alt="" referrerPolicy="no-referrer" className="h-10 w-10 shrink-0 rounded-lg object-cover" onError={() => setFailed(true)} />}
    <p className="min-w-0 flex-1 break-words text-sm font-medium">{title}</p>
  </div>;
}