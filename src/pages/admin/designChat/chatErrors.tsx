import { useEffect, useState, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Copy, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { supabase } from "@/prototype/client";
import { cn } from "@/lib/utils";
import { RELAY, relayHeaders, type Entry } from "./helper";

/** Error lines from the relay may carry an id and hasDetail (newer relays); older ones have neither. */
export type ErrorEntry = Entry & { id?: string; hasDetail?: boolean };

/* ---------- Dismissals: per person, presentation only (never touches busy/blocked/Submit state) ---------- */
export const DISMISS_CAP = 200;
const memory = new Map<string, string[]>();
const session = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;
const emit = () => { version++; listeners.forEach(l => l()); };
const storageKey = (person: string) => `nova:dismissed-errors:${person}`;
function read(person: string): string[] {
  try {
    const raw = localStorage.getItem(storageKey(person));
    if (raw !== null) { const v = JSON.parse(raw); if (Array.isArray(v)) return v.filter(x => typeof x === "string"); }
  } catch { /* storage unavailable: use memory */ }
  return memory.get(person) ?? [];
}
/** Session key for an error with no id (older relay). */
export const sessionErrorKey = (e: Entry) => `${e.ts ?? ""}|${e.text}`;
export function dismissError(person: string, e: ErrorEntry) {
  if (e.id) {
    const next = [...read(person).filter(x => x !== e.id), e.id].slice(-DISMISS_CAP);
    memory.set(person, next);
    try { localStorage.setItem(storageKey(person), JSON.stringify(next)); } catch { /* memory fallback */ }
  } else session.add(sessionErrorKey(e));
  emit();
}
export function isErrorDismissed(person: string, e: ErrorEntry): boolean {
  return e.id ? read(person).includes(e.id) : session.has(sessionErrorKey(e));
}
/** Test-only reset of in-memory state. */
export function resetErrorDismissals() { memory.clear(); session.clear(); emit(); }

/** The signed-in person's id (or "anon"), plus whether they hold the admin role — same check as the review findings. */
export function useChatPerson(): { person: string; isAdmin: boolean } {
  const [who, setWho] = useState<{ person: string; isAdmin: boolean }>({ person: "anon", isAdmin: false });
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const { data } = await supabase.auth.getUser();
        if (!data?.user) return;
        if (live) setWho(w => ({ ...w, person: data.user.id }));
        const { data: role } = await (supabase as any).rpc("has_role", { _user_id: data.user.id, _role: "admin" });
        if (live) setWho({ person: data.user.id, isAdmin: !!role });
      } catch { /* not signed in or not staff */ }
    })();
    return () => { live = false; };
  }, []);
  return who;
}
/** Re-renders when dismissals change; returns a filter for error entries. */
export function useErrorDismissals(person: string) {
  useSyncExternalStore(l => { listeners.add(l); return () => { listeners.delete(l); }; }, () => version, () => version);
  return {
    hidden: (e: ErrorEntry) => e.role === "error" && isErrorDismissed(person, e),
    dismiss: (e: ErrorEntry) => dismissError(person, e),
  };
}

export function DismissErrorButton({ onDismiss, phone }: { onDismiss: () => void; phone?: boolean }) {
  return <TooltipProvider><Tooltip><TooltipTrigger asChild>
    <Button type="button" variant="ghost" size="icon" aria-label="Dismiss Error" onClick={onDismiss}
      className={cn("shrink-0 text-destructive hover:text-destructive", phone ? "h-11 w-11" : "h-7 w-7")}><X className="h-4 w-4" aria-hidden /></Button>
  </TooltipTrigger><TooltipContent>Dismiss Error</TooltipContent></Tooltip></TooltipProvider>;
}

/* ---------- Details: admins only ---------- */
async function fetchErrorDetails(): Promise<Record<string, string>> {
  const res = await fetch(`${RELAY}/api/admin/error-details`, { cache: "no-store", headers: await relayHeaders() });
  if (!res.ok) throw new Error(String(res.status));
  const body = await res.json();
  const d = body?.details;
  return d && typeof d === "object" ? Object.fromEntries(Object.entries(d).filter(([, v]) => typeof v === "string")) as Record<string, string> : {};
}
/** Mount only for admins and only on lines with hasDetail, so the route is never called for anyone else. */
export function ErrorDetails({ id }: { id?: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const q = useQuery({ queryKey: ["chat", "error-details"], queryFn: fetchErrorDetails, staleTime: 30_000, retry: false });
  const text = id ? q.data?.[id] : undefined;
  return <div className="mt-1 text-xs">
    <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs" aria-expanded={open} onClick={() => setOpen(o => !o)}>{open ? "Hide Details" : "Show Details"}</Button>
    {open && (q.isLoading ? <p className="text-muted-foreground">Loading…</p>
      : text ? <div className="mt-1 space-y-1">
        <pre data-error-details className="max-h-60 overflow-auto whitespace-pre-wrap break-all rounded border bg-background p-2 font-mono text-[11px] text-foreground">{text}</pre>
        <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={() => { void navigator.clipboard?.writeText(text).catch(() => {}); setCopied(true); }}>
          {copied ? <Check className="h-3 w-3" aria-hidden /> : <Copy className="h-3 w-3" aria-hidden />}{copied ? "Copied" : "Copy Details"}
        </Button>
      </div>
      : <p className="text-muted-foreground">No Further Details</p>)}
  </div>;
}
