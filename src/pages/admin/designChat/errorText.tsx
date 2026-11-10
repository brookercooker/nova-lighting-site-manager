import { ChevronRight } from "lucide-react";

const TECH = /(the builder API error|\bAPI error:|query_error|Failed to run sql|\bERROR:\s*\d|PL\/pgSQL|violates (check|foreign key|unique) constraint)/i;
const RETRY = /\s(Try (sending it )?again\b[^]*)$/i;

/** Splits a stored error into the friendly sentence, an optional retry line and technical detail. Display only. */
export function splitErrorText(text: string): { friendly: string; detail: string; retry: string } | null {
  const m = TECH.exec(text);
  if (!m || m.index === 0) return null;
  const friendly = text.slice(0, m.index).trim();
  let rest = text.slice(m.index);
  let retry = "";
  const r = RETRY.exec(rest);
  if (r) { retry = r[1].trim(); rest = rest.slice(0, r.index); }
  const detail = rest.trim();
  return friendly && detail ? { friendly, detail, retry } : null;
}

export default function ErrorText({ text }: { text: string }) {
  const parts = splitErrorText(text);
  if (!parts) return <>{text}</>;
  return <>
    {parts.friendly}{parts.retry && <> {parts.retry}</>}
    <details className="group mt-1 min-w-0 text-xs">
      <summary className="inline-flex min-h-8 cursor-pointer list-none items-center gap-1 rounded-sm underline-offset-2 hover:underline focus-visible:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden"><ChevronRight data-testid="details-chevron" aria-hidden className="h-3.5 w-3.5 shrink-0 transition-transform group-open:rotate-90 motion-reduce:transition-none" />Technical Details</summary>
      <pre className="mt-1 max-h-48 max-w-full select-text overflow-auto whitespace-pre-wrap break-all rounded bg-background/60 p-2 font-mono text-[11px]">{parts.detail}</pre>
    </details>
  </>;
}
