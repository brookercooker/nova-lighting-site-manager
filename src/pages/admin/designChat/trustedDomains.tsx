import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ShieldCheck, Trash2 } from "lucide-react";
import { useChatPerson } from "./chatErrors";

export function useTrustedDomains() {
  const client = useQueryClient();
  const { isAdmin } = useChatPerson();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const query = useQuery({ queryKey: ["trusted-review-domains"], enabled: isAdmin, queryFn: async () => {
    const { data, error } = await supabase.from("trusted_review_domains").select("domain,created_at").order("domain");
    if (error) throw error;
    return data.map(r => r.domain);
  } });
  const change = async (domain: string, remove = false) => {
    if (!isAdmin || pending) return;
    setPending(true); setError("");
    try {
      const result = remove ? await supabase.from("trusted_review_domains").delete().eq("domain", domain).select("domain") : await supabase.from("trusted_review_domains").insert({ domain }).select("domain");
      if (result.error || !result.data?.length) throw new Error("Trusted domains couldn't be updated. Please try again.");
      await client.invalidateQueries({ queryKey: ["trusted-review-domains"] });
    } catch (e) { setError(e instanceof Error ? e.message : "Couldn't update trusted domains."); }
    finally { setPending(false); }
  };
  return { domains: query.data ?? [], isAdmin, pending, error: error || (query.isError ? "Trusted domains couldn't be loaded." : ""), change };
}
export function TrustedDomainList({ trust }: { trust: ReturnType<typeof useTrustedDomains> }) {
  const [open, setOpen] = useState(false);
  if (!trust.isAdmin) return null;
  return <div className="min-w-0 border-y py-1">
    <Button variant="ghost" className="h-11 w-full justify-start" aria-expanded={open} onClick={() => setOpen(v => !v)}><ShieldCheck aria-hidden />Trusted Domains ({trust.domains.length})</Button>
    {open && <ul className="max-h-48 overflow-y-auto">{trust.domains.map(domain => <li key={domain} className="flex min-w-0 items-center justify-between gap-2"><span className="break-all text-sm">{domain}</span><Button variant="ghost" className="h-11 w-11 shrink-0" disabled={trust.pending} aria-label={`Remove Trusted Domain: ${domain}`} onClick={() => void trust.change(domain, true)}><Trash2 aria-hidden /></Button></li>)}{!trust.domains.length && <li className="text-xs text-muted-foreground">No domains have been trusted yet.</li>}</ul>}
    {trust.error && <p role="alert" className="break-words text-xs text-destructive">{trust.error}</p>}
  </div>;
}