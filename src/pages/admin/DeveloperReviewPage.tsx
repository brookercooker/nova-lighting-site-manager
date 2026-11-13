import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { ArrowLeft, ExternalLink, Loader2 } from "lucide-react";
import { supabase } from "@/prototype/client";
import { Button } from "@/components/ui/button";
import { RELAY, RELAY_IS_HOSTED, relayHeaders } from "./designChat/helper";
import { useHelperState } from "./designChat/useHelperState";
import { REQUIRE_LOGIN } from "@/lib/authGate";

function ReviewErrorDetails() {
  const { state } = useHelperState(() => 4000);
  const review = state?.draft?.review;
  if (review?.state !== "error") return null;
  return (
    <div role="region" aria-label="Review Error Details" className="border-b px-6 py-4 space-y-2 text-sm">
      <p className="font-medium whitespace-pre-wrap break-words">{review.headline || "No reason was reported by the design service."}</p>
      {review.summary && <p className="whitespace-pre-wrap break-words">{review.summary}</p>}
      <p className="text-xs text-muted-foreground">{review.retry === true ? "Staff can retry this themselves" : "Needs a Developer"}</p>
    </div>
  );
}

export default function DeveloperReviewPage() {
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const tokenRef = useRef("");
  const tokenPromise = useRef<Promise<void> | null>(null);
  const [frameLoading, setFrameLoading] = useState(true);
  const draftSiteUrl = window.location.origin + "/manage/preview";
  const sendToken = useCallback(() => {
    if (!tokenRef.current) return;
    let origin: string;
    try { origin = new URL(RELAY).origin; } catch { return; }
    iframeRef.current?.contentWindow?.postMessage({ type: "nova-dev-token", token: tokenRef.current, page: draftSiteUrl }, origin);
  }, [draftSiteUrl]);

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data, error }: any) => {
      if (error || !data.user) { setIsAdmin(false); return; }
      const { data: roleData } = await (supabase as any).rpc("has_role", {
        _user_id: data.user.id, _role: "admin",
      });
      setIsAdmin(!!roleData);
    });
  }, []);

  useLayoutEffect(() => {
    if (!RELAY_IS_HOSTED) return;
    let relayOrigin: string;
    try { relayOrigin = new URL(RELAY).origin; } catch { return; }
    let live = true;
    // Warm authentication while the staff check runs, not after the child asks.
    tokenPromise.current = relayHeaders().then((headers) => {
      const key = Object.keys(headers).find((k) => k.toLowerCase() === "authorization");
      if (live) { tokenRef.current = key ? headers[key].replace(/^Bearer /, "") : ""; sendToken(); }
    }).catch(() => {});
    const onMessage = (e: MessageEvent) => {
      if (e.source !== iframeRef.current?.contentWindow) return;
      if (e.origin !== relayOrigin) return;
      if (e.data?.type === "nova-dev-ready") { setFrameLoading(false); return; }
      if (e.data?.type !== "nova-dev-need-token") return;
      if (tokenRef.current) sendToken();
      else void tokenPromise.current?.then(() => { if (live) sendToken(); });
    };
    window.addEventListener("message", onMessage);
    return () => { live = false; tokenRef.current = ""; window.removeEventListener("message", onMessage); };
  }, [sendToken]);

  useEffect(() => {
    if (!isAdmin || !RELAY_IS_HOSTED) return;
    const timer = setTimeout(() => setFrameLoading(false), 20_000);
    return () => clearTimeout(timer);
  }, [isAdmin]);

  if (isAdmin === null) return <div className="min-h-screen" />;
  if (REQUIRE_LOGIN && !isAdmin) return <Navigate to="/manage/pages" replace />;

  return (
    <div className="h-screen flex flex-col">
      <header className="sticky top-0 z-30 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="w-full px-3 min-[480px]:px-6 py-3 flex items-center gap-2 min-[480px]:gap-4">
          <Button asChild variant="ghost" size="sm" className="h-11 gap-2 shrink-0 max-sm:w-11 max-sm:p-0">
            <Link to="/manage/pages" aria-label="Site Manager"><ArrowLeft className="w-4 h-4" /><span className="hidden sm:inline">Site Manager</span></Link>
          </Button>
          <h1 className="text-base font-medium tracking-tight">Developer Review</h1>
          {isAdmin && RELAY_IS_HOSTED && (
            <Button asChild variant="outline" size="sm" className="ml-auto h-11 min-w-11 shrink-0 gap-2 px-2 min-[480px]:px-3">
              <a href={draftSiteUrl} target="_blank" rel="noopener noreferrer" aria-label="Open Draft Site">
                <ExternalLink className="w-4 h-4" aria-hidden="true" />
                <span className="hidden min-[480px]:inline">Open Draft Site</span>
              </a>
            </Button>
          )}
        </div>
      </header>
      {isAdmin && <ReviewErrorDetails />}
      {!isAdmin ? <div className="p-6 text-sm text-muted-foreground">Sign in to load or save this. Developer review requires an authorized account.</div> : RELAY_IS_HOSTED ? (
        <div className="relative min-h-0 flex-1">
        <iframe
          ref={iframeRef}
          title="Developer Review"
          referrerPolicy="no-referrer"
          src={`${RELAY}/dev`}
          onLoad={sendToken}
          className="h-full w-full border-0"
        />
        {frameLoading && <div role="status" className="absolute inset-0 flex items-center justify-center gap-2 bg-background text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />Loading the draft…
        </div>}
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center p-6 text-center text-sm text-muted-foreground">
          The developer review needs the hosted design service.
        </div>
      )}
    </div>
  );
}
