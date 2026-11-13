import { ReactNode, useEffect, useRef, useState } from "react";

/** Retain grid geometry while unmounting distant card contents. */
export default function LibraryWindow({ children, kind, compact = false, grid = false }: { children: () => ReactNode; kind: "image" | "video"; compact?: boolean; grid?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(typeof IntersectionObserver === "undefined");
  const [height, setHeight] = useState<number>();
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry) setNear(entry.isIntersecting);
    }, { rootMargin: "600px" });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el || !near || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      const next = el.getBoundingClientRect().height;
      if (next > 0) setHeight(next);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [near]);
  return <div ref={ref} data-library-window={kind} className={grid ? "nova-library-grid-window" : near ? "min-w-0" : compact ? "min-w-0 h-[77px]" : kind === "image" ? "min-w-0 aspect-square" : "min-w-0 aspect-video"} style={!grid && !near && height ? { height, aspectRatio: "auto" } : undefined}>{near ? children() : grid ? <><div className="aspect-[4/3]" /><div className="h-[114px]" /></> : null}</div>;
}