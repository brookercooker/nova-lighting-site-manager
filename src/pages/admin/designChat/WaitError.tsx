import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import ErrorText from "./errorText";
import type { WaitView } from "./waitEstimates";

/** All failed-wait surfaces share the provider's deadline and interaction ownership. */
export default function WaitError({ progress, className }: { progress: WaitView; className?: string }) {
  const owner = useRef({});
  const hover = useRef(false), focus = useRef(false);
  const controls = useRef(progress.errorControls); controls.current = progress.errorControls;
  const update = () => controls.current?.pause(owner.current, hover.current || focus.current);
  useEffect(() => () => controls.current?.pause(owner.current, false), []);
  return <div role="status" className={cn("pointer-events-auto min-w-0 space-y-1 text-destructive transition-opacity duration-200 motion-reduce:transition-none", progress.fading && "opacity-0", className)}
    onMouseEnter={() => { hover.current = true; update(); }} onMouseLeave={() => { hover.current = false; update(); }}
    onFocusCapture={() => { focus.current = true; update(); }} onBlurCapture={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) { focus.current = false; update(); } }}>
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="min-w-0 flex-1 text-xs">{typeof progress.label === "string" ? <ErrorText text={progress.label} /> : progress.label}</span>
      {progress.errorControls?.retry && <Button type="button" variant="link" size="sm" className="h-8 p-0 text-xs" disabled={progress.errorControls.disabled} onClick={progress.errorControls.retry}>Try Again</Button>}
      {progress.errorControls && <Button type="button" variant="ghost" size="icon" className="h-11 w-11 shrink-0" aria-label="Dismiss" onClick={progress.errorControls.dismiss}><X className="h-3.5 w-3.5" /></Button>}
    </div>
    {progress.errorControls?.note && <p className="text-xs">{progress.errorControls.note}</p>}
    <div role="progressbar" aria-label={progress.label} aria-valuetext={progress.label} className="h-[6px] overflow-hidden rounded-full bg-destructive/15"><div className="h-full bg-destructive" style={{ width: `${progress.value * 100}%` }} /></div>
  </div>;
}