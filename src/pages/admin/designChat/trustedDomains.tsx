import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ShieldCheck, Trash2 } from "lucide-react";
import { useChatPerson } from "./chatErrors";
import { callAdminUsers } from "../adminUsers";
import { walk } from "./submitWalkthroughStore";
import { domainOf } from "./linkRisk";

export function useTrustedDomains() {
  const client = useQueryClient();
  const { isAdmin } = useChatPerson();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const query = useQuery({ queryKey: ["trusted-review-domains"], enabled: isAdmin, queryFn: async () => {
    const { data, error } = await supabase.from("trusted_review_domains").select("domain,created_at,created_by").order("domain");
    if (error) throw error;
    return data;
  } });
  const authors = useQuery({ queryKey: ["review-trust-authors"], enabled: isAdmin && !!query.data?.length, queryFn: () => callAdminUsers() });
  const change = async (domain: string, remove = false) => {
    if (!isAdmin || pending) return;
    setPending(true); setError("");
    try {
      const result = remove ? await supabase.from("trusted_review_domains").delete().eq("domain", domain).select("domain") : await supabase.from("trusted_review_domains").insert({ domain }).select("domain");
      if (result.error || !result.data?.length) throw new Error("Trusted domains couldn't be updated. Please try again.");
      if (remove) {
        client.setQueryData<typeof query.data>(["trusted-review-domains"], old => old?.filter(r => r.domain !== domain));
        const keys = new Set(walk.get().savedReviewLinks.filter(x => domainOf(x.link.href) === domain).map(x => x.link.key));
        const reset = (map: Record<string,string>) => Object.fromEntries(Object.entries(map).filter(([key]) => !keys.has(key)));
        walk.update(s => ({ ...s, verificationOpened: reset(s.verificationOpened), linkApprovals: reset(s.linkApprovals), linkReplaced: reset(s.linkReplaced), linkTicked: s.linkTicked.filter(k => !keys.has(k)) }));
      }
      await client.invalidateQueries({ queryKey: ["trusted-review-domains"] });
    } catch (e) { setError(e instanceof Error ? e.message : "Couldn't update trusted domains."); }
    finally { setPending(false); }
  };
  const records = (query.data ?? []).map(row => ({ ...row, author: (authors.data?.users ?? []).find((u: {id:string}) => u.id === row.created_by)?.email?.split("@")[0] ?? "Admin" }));
  return { domains: records.map(r => r.domain), records, isAdmin, pending, error: error || (query.isError ? "Trusted domains couldn't be loaded." : ""), change };
}
export function TrustedDomainList({ trust }: { trust: Omit<ReturnType<typeof useTrustedDomains>, "records"> & { records?: ReturnType<typeof useTrustedDomains>["records"] } }) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState<string | null>(null);
  if (!trust.isAdmin) return null;
  return <div className="min-w-0 border-y py-1">
    <Button variant="ghost" className="h-11 w-full justify-start" aria-expanded={open} onClick={() => setOpen(v => !v)}><ShieldCheck aria-hidden />Trusted Domains ({trust.domains.length})</Button>
    {open && <ul className="max-h-48 overflow-y-auto">{trust.domains.map(domain => {
      const record = trust.records?.find(r => r.domain === domain);
      return <li key={domain} className="min-w-0"><div className="flex items-center justify-between gap-2"><div className="min-w-0"><span className="break-all text-sm">{domain}</span>{record && <p className="text-xs text-muted-foreground">Added by {record.author} · {new Date(record.created_at).toLocaleDateString(undefined,{month:"short",day:"numeric"})}</p>}</div><Button variant="ghost" className="h-11 w-11 shrink-0" disabled={trust.pending} aria-label={`Remove Trusted Domain: ${domain}`} onClick={() => setConfirm(domain)}><Trash2 aria-hidden /></Button></div>{confirm === domain && <div className="text-xs"><p>Stop trusting {domain}? Links to it will need review again.</p><div className="flex gap-2"><Button className="h-11" disabled={trust.pending} onClick={() => { void trust.change(domain,true); setConfirm(null); }}>Stop Trusting</Button><Button variant="ghost" className="h-11" onClick={() => setConfirm(null)}>Cancel</Button></div></div>}</li>;
    })}{!trust.domains.length && <li className="text-xs text-muted-foreground">No domains have been trusted yet.</li>}</ul>}
    {trust.error && <p role="alert" className="break-words text-xs text-destructive">{trust.error}</p>}
  </div>;
}