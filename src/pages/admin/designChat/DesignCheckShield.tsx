import { useRef, useEffect } from "react";
import { frameOrigin } from "./linkCheck";
import { shownPreviewFrame } from "./previewNavigate";

/** Read-only canvas: pointer gestures scroll through the existing public scroll protocol. */
export function DesignCheckShield({ path }: { path: string }) {
  const y = useRef(0);
  const touch = useRef<number | null>(null);
  useEffect(() => {
    y.current = 0;
    const receive = (event: MessageEvent) => {
      const frame = shownPreviewFrame(document);
      if (event.source !== frame?.contentWindow || event.origin !== frameOrigin(frame)) return;
      const d = event.data;
      if (d?.source === "nova-site" && d.type === "page-scroll" && d.path === path && Number.isFinite(d.y)) y.current = d.y;
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [path]);
  const scroll = (delta: number) => {
    const frame = shownPreviewFrame(document), origin = frameOrigin(frame);
    if (!origin || !frame?.contentWindow) return;
    y.current = Math.max(0, y.current + delta);
    frame.contentWindow.postMessage({ source: "nova-manager", type: "restore-scroll", path, y: y.current }, origin);
  };
  return <div role="region" aria-label="Design Check Preview" tabIndex={0}
    className="absolute inset-0 z-20 touch-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    onWheel={e => { e.preventDefault(); scroll(e.deltaY); }}
    onTouchStart={e => { touch.current = e.touches[0]?.clientY ?? null; }}
    onTouchMove={e => { const next = e.touches[0]?.clientY; if (next === undefined || touch.current === null) return; scroll(touch.current - next); touch.current = next; }}
    onTouchEnd={() => { touch.current = null; }}
    onKeyDown={e => { const delta = e.key === "ArrowDown" ? 60 : e.key === "ArrowUp" ? -60 : e.key === "PageDown" || e.key === " " ? e.currentTarget.clientHeight * .8 : e.key === "PageUp" ? -e.currentTarget.clientHeight * .8 : 0; if (delta) { e.preventDefault(); scroll(delta); } }} />;
}