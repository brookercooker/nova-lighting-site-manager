import { notePreviewReady, postPreviewNavigate, type PreviewNavigate } from "./previewNavigate";
import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode, type RefObject } from "react";
import type { RelayState } from "./helper";
import { useLocation } from "react-router-dom";
import { usePreviewNotifications } from "./usePreviewNotifications";
import { useHelperState } from "./useHelperState";
import { usePreview } from "./usePreview";
import { usePreviewPage, type PreviewPage } from "./usePreviewPage";
import { useDrawing, type Drawing } from "./useDrawing";
import type { RegistrablePage } from "./registerPage";
import { syncManifestPages } from "../manifestPageSync";
import { MANIFEST_CHANGED } from "../siteManifest";
import ManifestReceiverFrame from "./ManifestReceiverFrame";
import { useChatReferences, type ChatReferences } from "./useChatReferences";
import { emptyHistory, visit, step, canBack, canForward, previewAddressMatches, stripPreviewTokens, type PreviewHistory } from "./previewHistory";
import { observeContentSyncState } from "./contentSync";
import { useChatDraft } from "./useChatDraft";
import { useWaitProgress } from "./useWaitProgress";
import { useRequestRetry } from "./useRequestRetry";

/**
 * One place that holds the design chat's live state, so the chat (always on the right of the Site Manager), the preview
 * (one of the tabs) and the buttons in the top bar all see the same thing, and nothing restarts when someone switches tabs.
 */

/** How long Back/Forward/page choice waits for the preview to report the new page before reloading it once. */
export const NAV_FALLBACK_MS = 3000;
/** Bound duplicate/conflicting reports after a Manager navigation, without pinning later visitor navigation. */
export const NAV_SETTLE_MS = 1500;
/** Opt-in navigation diagnostics; never log frame addresses containing embed credentials. */
function debugNav(event: string, details: Record<string, unknown>) {
  try { if (sessionStorage.getItem("nova:debug-nav") === "1") console.debug("[nav]", event, details); } catch { /* Optional diagnostics. */ }
}
/** An object open in the editor; `from` decides the back link (page or the Objects list). */
export interface ObjectOpen { id: string; section?: string; slot?: string; from: "page" | "objects" }
export type Device = "mobile" | "tablet" | "desktop";

/** A page the person picked in the Pages tab for the chat to work on. */
export type WorkingPage = { id?: string; name: string; path: string };

// Older builds kept the picked page in tab storage; it is no longer restored because it went stale.
const LEGACY_WORKING_PAGE_KEY = "nova:design-chat:working-page";

/** The working page and whether it is open in the editor. Kept pure so the rules can be tested. */
export type WorkingState = { workingPage: WorkingPage | null; editing: boolean };
export type WorkingAction =
  | { type: "select"; page: WorkingPage }
  | { type: "clear" }
  | { type: "start" }
  | { type: "stop" };

export function workingReducer(s: WorkingState, a: WorkingAction): WorkingState {
  switch (a.type) {
    // Picking a different page while editing keeps editing on; the editor switches to it.
    case "select": return { workingPage: a.page, editing: s.editing && !!a.page.id };
    case "clear": return { workingPage: null, editing: false };
    case "start": return s.workingPage?.id ? { ...s, editing: true } : s;
    case "stop": return s.editing ? { ...s, editing: false } : s;
  }
}

export type DesignChat = {
  waitProgress?: ReturnType<typeof useWaitProgress>;
  requestRetry?: ReturnType<typeof useRequestRetry>;
  chatDraft?: ReturnType<typeof useChatDraft>;
  mode: "chat" | "manual";
  state: RelayState | null;
  offline: boolean;
  refreshSoon: () => void;
  retryNow: () => void;
  preview: ReturnType<typeof usePreview>;
  device: Device;
  setDevice: (d: Device) => void;
  /** The element the preview sits in (what "Full screen" expands). Set by the preview. */
  boxRef: RefObject<HTMLDivElement>;
  /** The element the page editor sits in while editing (what "Full screen" expands then). */
  editBoxRef: RefObject<HTMLDivElement>;
  inFull: boolean;
  /** Full screen was done by covering the window, because the browser wouldn't do it. */
  coverFull: boolean;
  toggleFull: () => void;
  workingPage: WorkingPage | null;
  /** The page the chat works on, and the preview shows. */
  selectPage: (page: WorkingPage) => void;
  /** Stop focusing the chat on a page (the preview stays where it is). */
  clearWorkingPage: () => void;
  /** The working page is open in the page editor (on the Preview tab), with its options in the left column. */
  editing: boolean;
  /** Open the working page in the editor. Does nothing without a working page that has an id. */
  startEditing: () => void;
  stopEditing: () => void;
  /** The left column shows the changes waiting for review instead of the chat (the chat stays mounted). */
  reviewOpen: boolean;
  setReviewOpen: (open: boolean) => void;
  /** Move the preview to an address without changing the working page. */
  showPreviewPath: (path: string) => void;
  /** An object opened from the page editor, shown in its place while editing. */
  objectOpen: ObjectOpen | null;
  /** The object the page editor should scroll back to after the object editor closes. */
  returnTo: { slot: string | null; objectId: string } | null;
  openObject: (id: string, section?: string, opts?: { slot?: string; from?: "page" | "objects" }) => void;
  closeObject: () => void;
  /** The address the visitor is on inside the preview (null until the site reports one). */
  previewLocation: { path: string; search: string; notFound?: boolean } | null;
  /** Requested address for instant toolbar feedback; reported location remains authoritative for page data. */
  previewDestination?: string | null;
  previewNavigating?: boolean;
  /** The Site Manager page at that address, if any. */
  previewPage: PreviewPage | null;
  previewPageLoading: boolean;
  previewRegistrable: RegistrablePage | null;
  /** The pencil on the preview: marks drawn over it, sent with the next request. */
  drawing: Drawing;
  /** Library items picked from the top bar for the next request. */
  refs: ChatReferences;
  /** Back/Forward through the pages shown in the preview (both off while editing). Optional so older test mocks still fit. */
  previewNav?: { canBack: boolean; canForward: boolean; back: () => void; forward: () => void };
};

const Ctx = createContext<DesignChat | null>(null);

export function helperPollingInterval(s: RelayState | null, recent: boolean): number {
  return s && (s.busy || s.previewChecking === true || s.publish?.status === "reviewing" || recent) ? 1000 : 4000;
}

export function DesignChatProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    const sync = () => { void syncManifestPages(); };
    sync();
    window.addEventListener(MANIFEST_CHANGED, sync);
    return () => window.removeEventListener(MANIFEST_CHANGED, sync);
  }, []);
  // The preview hook needs the helper's state; the helper's polling speed needs to know when the preview last reloaded.
  const lastReload = useRef<{ current: number } | null>(null);
  const { state, offline, refreshSoon, retryNow } = useHelperState((s: RelayState | null) => {
    const recent = lastReload.current ? Date.now() - lastReload.current.current < 180_000 : false;
    return helperPollingInterval(s, recent);
  });

  const [previewPath, setPreviewPath] = useState<string | null>(null);
  useEffect(() => { if (!offline) observeContentSyncState(state); }, [state, offline]);
  const [navNonce, setNavNonce] = useState(0);
  const preview = usePreview(state, previewPath, navNonce);
  const requestRetry = useRequestRetry(state, offline, refreshSoon);
  const trackedProgress = useWaitProgress(requestRetry.optimisticState, preview.frameLoadedAt) ?? { request: null, submit: null };
  const failedRequest = trackedProgress.request;
  const waitProgress = failedRequest?.error && failedRequest.errorControls && failedRequest.requestAt !== undefined
    ? { ...trackedProgress, request: { ...failedRequest, errorControls: { ...failedRequest.errorControls,
      retry: requestRetry.canRetry(failedRequest.requestAt) ? () => { void requestRetry.retry(failedRequest.requestAt ?? 0, failedRequest.errorControls?.dismiss ?? (() => {})); } : undefined,
      disabled: requestRetry.disabled, note: requestRetry.retryNote(failedRequest.requestAt) } } } : trackedProgress;
  lastReload.current = preview.lastReloadAt;

  const [device, setDevice] = useState<Device>("desktop");
  const [full, setFull] = useState(false); // full screen done by the browser
  const [coverFull, setCoverFull] = useState(false); // or, if it won't, by covering the window
  const boxRef = useRef<HTMLDivElement>(null);
  const editBoxRef = useRef<HTMLDivElement>(null);
  const [work, dispatch] = useReducer(workingReducer, { workingPage: null, editing: false });
  const editing = work.editing;
  const mode = editing ? "manual" : "chat";
  const location = useLocation();
  usePreviewNotifications(preview.completedAt, location.pathname, editing);

  useEffect(() => {
    const sync = () => setFull(Boolean(document.fullscreenElement));
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setCoverFull(false); };
    document.addEventListener("fullscreenchange", sync);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("fullscreenchange", sync); document.removeEventListener("keydown", esc); };
  }, []);

  const toggleFull = useCallback(async () => {
    if (document.fullscreenElement) { await document.exitFullscreen().catch(() => {}); return; }
    if (coverFull) { setCoverFull(false); return; }
    try { await (editing ? editBoxRef.current : boxRef.current)?.requestFullscreen(); } catch { setCoverFull(true); }
  }, [coverFull, editing]);
  // Leaving edit mode leaves full screen too.
  useEffect(() => {
    if (editing) return;
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    setCoverFull(false);
  }, [editing]);

  const workingPage = work.workingPage;
  useEffect(() => { try { sessionStorage.removeItem(LEGACY_WORKING_PAGE_KEY); } catch { /* storage unavailable */ } }, []);
  // Read by the location listener so a settled visitor navigation can release a stale picked page.
  const workRef = useRef(work);
  workRef.current = work;
  // Back/Forward/page choice move the mounted preview in place; a src change happens only as a single fallback.
  const pendingNav = useRef<{ expect: string; timer: ReturnType<typeof setTimeout> } | null>(null);
  const settledNav = useRef<{ address: string; source: MessageEventSource; until: number } | null>(null);
  const [previewDestination, setPreviewDestination] = useState<string | null>(null);
  const [previewNavigating, setPreviewNavigating] = useState(false);
  const navigationCue = useRef<ReturnType<typeof setTimeout>>();
  const clearNavigationCue = useCallback(() => {
    clearTimeout(navigationCue.current);
    setPreviewDestination(null);
    setPreviewNavigating(false);
  }, []);
  const shownPath = useRef<string | null>(null);
  // The page asked for sticks until the preview reports it (first-load race: the frame may still be on the home page).
  const target = useRef<{ path: string; tries: number } | null>(null);
  // `sticky` re-asks for a picked page until it arrives (first-load race). History steps are not sticky: the step already
  // moved the index, the pending confirmation and fallback cover a lost message, and re-sends would fight later steps.
  const navigatePreview = useCallback((nav: PreviewNavigate, expect: string, fallback: () => void, sticky = true) => {
    debugNav("navigate", { action: nav.action, expect });
    settledNav.current = null;
    target.current = nav.action === "to" && sticky ? { path: expect, tries: 0 } : null;
    const superseding = pendingNav.current !== null;
    if (pendingNav.current) { clearTimeout(pendingNav.current.timer); pendingNav.current = null; }
    if (!superseding && nav.action === "to" && shownPath.current && previewAddressMatches(expect, shownPath.current)) { clearNavigationCue(); return; }
    clearTimeout(navigationCue.current);
    setPreviewDestination(expect);
    setPreviewNavigating(false);
    navigationCue.current = setTimeout(() => setPreviewNavigating(true), 150);
    const posted = postPreviewNavigate(nav);
    debugNav(posted ? "posted" : "waiting for ready", { action: nav.action, expect });
    const timer = setTimeout(() => { if (pendingNav.current?.timer === timer) { debugNav("timeout fallback", { expect }); pendingNav.current = null; fallback(); } }, NAV_FALLBACK_MS);
    pendingNav.current = { expect, timer };
  }, [clearNavigationCue]);
  useEffect(() => () => { if (pendingNav.current) clearTimeout(pendingNav.current.timer); clearTimeout(navigationCue.current); }, []);
  useEffect(() => {
    if (preview.error || (preview.frameLoadedAt && !pendingNav.current)) clearNavigationCue();
  }, [preview.frameLoadedAt, preview.error, clearNavigationCue]);
  const selectPage = useCallback((page: WorkingPage) => {
    dispatch({ type: "select", page });
    navigatePreview({ action: "to", path: page.path }, page.path, () => { setPreviewPath(page.path); setNavNonce((n) => n + 1); });
    setObjectOpen(null);
  }, [navigatePreview]);
  const showPreviewPath = useCallback((path: string) => {
    navigatePreview({ action: "to", path }, path, () => { setPreviewPath(path); setNavNonce((n) => n + 1); });
  }, [navigatePreview]);
  const [reviewOpen, setReviewOpen] = useState(false);
  useEffect(() => { if (editing) setReviewOpen(false); }, [editing]);
  const clearWorkingPage = useCallback(() => { dispatch({ type: "clear" }); setObjectOpen(null); }, []);
  const startEditing = useCallback(() => dispatch({ type: "start" }), []);
  const stopEditing = useCallback(() => { dispatch({ type: "stop" }); setObjectOpen(null); }, []);
  // Leaving Manual Edit Mode: make sure the Chat preview is on the page that was being edited.
  const wasEditing = useRef(editing);
  useEffect(() => {
    const left = wasEditing.current && !editing;
    wasEditing.current = editing;
    const page = workRef.current.workingPage;
    if (!left || !page) return;
    if (pendingNav.current || (shownPath.current && previewAddressMatches(page.path, shownPath.current))) return;
    navigatePreview({ action: "to", path: page.path }, page.path, () => { setPreviewPath(page.path); setNavNonce((n) => n + 1); });
  }, [editing, navigatePreview]);
  const [objectOpen, setObjectOpen] = useState<ObjectOpen | null>(null);
  // From Tools > Objects the editor starts in the same tick as editing, so that path doesn't wait for it.
  const openObject = useCallback((id: string, section?: string, opts?: { slot?: string; from?: "page" | "objects" }) => {
    if (editing || opts?.from === "objects") setObjectOpen({ id, section, slot: opts?.slot, from: opts?.from ?? "page" });
  }, [editing]);
  const [returnTo, setReturnTo] = useState<{ slot: string | null; objectId: string } | null>(null);
  const closeObject = useCallback(() => { if (objectOpen) setReturnTo({ slot: objectOpen.slot ?? null, objectId: objectOpen.id }); setObjectOpen(null); }, [objectOpen]);
  useEffect(() => { if (objectOpen) return; const t = setTimeout(() => setReturnTo(null), 5000); return () => clearTimeout(t); }, [objectOpen, returnTo]);

  const [previewLocation, setPreviewLocation] = useState<{ path: string; search: string; notFound?: boolean } | null>(null);
  const rememberPath = preview.rememberPath;
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (notePreviewReady(event)) {
        // A loaded frame may announce readiness just after the click. Retain it
        // and retry the requested address within the existing single fallback.
        const pending = pendingNav.current;
        if (pending) { postPreviewNavigate({ action: "to", path: pending.expect }); return; }
        const t = target.current;
        if (t && (!shownPath.current || !previewAddressMatches(t.path, shownPath.current)) && t.tries < 5) { t.tries++; postPreviewNavigate({ action: "to", path: t.path }); }
        return;
      }
      const d = event.data;
      if (!d || typeof d !== "object" || d.source !== "nova-site" || d.type !== "location") return;
      if (typeof d.path !== "string" || !d.path.startsWith("/") || d.path.length > 300) return;
      const reportingFrame = Array.from(document.querySelectorAll<HTMLIFrameElement>("iframe[data-site-preview], iframe[data-site-editor]")).find((f) => {
        try { return f.contentWindow === event.source && new URL(f.src).origin === event.origin; } catch { return false; }
      });
      if (!event.source || !reportingFrame) return;
      if (Array.from(document.querySelectorAll<HTMLIFrameElement>("iframe[data-manifest-receiver]")).some((f) => f.contentWindow === event.source)) return;
      console.debug("[preview] location", d.path);
      // Preview credentials (`__lovable_*`) are dropped here so they are never compared, kept in history, remembered or logged.
      const search = typeof d.search === "string" && d.search.length <= 300 ? stripPreviewTokens(d.search) : "";
      debugNav("location", { path: d.path, search, expect: pendingNav.current?.expect });
      const settled = settledNav.current;
      if (settled && (settled.source !== event.source || Date.now() >= settled.until)) settledNav.current = null;
      else if (settled && !pendingNav.current && !previewAddressMatches(settled.address, d.path, search)
        && reportingFrame.hasAttribute("data-site-preview")) {
        // `iframe.src` is the original address, not the SPA's current route. A cross-origin frame's live
        // location is unreadable, so only suppress conflicts for a bounded settling window. Do not
        // extend that window on duplicate reports: later visitor navigation must remain possible.
        debugNav("settled conflict ignored", { path: d.path, search });
        return;
      }
      const notFound = d.notFound === true;
      if (!reportingFrame.hasAttribute("data-site-preview")) {
        // The Manual Edit frame shows the page too, but it is a separate window: its reports must never
        // confirm a navigation meant for the Chat preview, or the preview stays on its old page after editing.
        setPreviewLocation((cur) => (cur && cur.path === d.path && cur.search === search && Boolean(cur.notFound) === notFound ? cur : { path: d.path, search, ...(notFound ? { notFound: true } : {}) }));
        return;
      }
      const t = target.current;
      if (t && !previewAddressMatches(t.path, d.path, search)) {
        // Still showing an earlier page: ask again (bounded) rather than adopt it.
        if (t.tries < 5) { t.tries++; postPreviewNavigate({ action: "to", path: t.path }); }
        return;
      }
      target.current = null;
      const pending = pendingNav.current;
      if (pending && !previewAddressMatches(pending.expect, d.path, search)) return;
      // A settled location the Manager didn't request (visitor link, builder navigation) releases a
      // picked page it no longer matches, like the chip's X, so requests never carry a stale page.
      const w = workRef.current;
      if (!pending && !t && !settledNav.current && !w.editing && w.workingPage && reportingFrame.hasAttribute("data-site-preview")
        && !previewAddressMatches(w.workingPage.path, d.path, search)) dispatch({ type: "clear" });
      if ((pending || t) && reportingFrame.hasAttribute("data-site-preview")) {
        settledNav.current = { address: d.path + search, source: event.source, until: Date.now() + NAV_SETTLE_MS };
      }
      setPreviewLocation((cur) => (cur && cur.path === d.path && cur.search === search && Boolean(cur.notFound) === notFound ? cur : { path: d.path, search, ...(notFound ? { notFound: true } : {}) }));
      rememberPath(d.path + search);
      shownPath.current = d.path + search;
      if (pending && previewAddressMatches(pending.expect, d.path, search)) { debugNav("matched", { expect: pending.expect, path: d.path, search }); clearTimeout(pending.timer); pendingNav.current = null; }
      clearNavigationCue();
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [rememberPath, clearNavigationCue]);
  // Back/Forward: every address the preview reports is visited; arrivals from Back/Forward match the current entry and add nothing.
  const [history, setHistory] = useState<PreviewHistory>(emptyHistory);
  useEffect(() => {
    if (previewLocation) setHistory((h) => visit(h, previewLocation.path + previewLocation.search));
  }, [previewLocation]);
  const historyRef = useRef(history);
  historyRef.current = history;
  const go = useCallback((by: -1 | 1) => {
    if (editing) return; // the editor is on screen; leaving it goes through Save Changes / Discard Changes
    const r = step(historyRef.current, by);
    if (!r.address) return;
    historyRef.current = r.history;
    setHistory(r.history);
    const address = r.address;
    // Back/Forward away from the picked page releases it (like the chip X) so requests follow what is shown.
    const picked = workRef.current.workingPage;
    if (picked && !previewAddressMatches(picked.path, address.split(/[?#]/)[0])) dispatch({ type: "clear" });
    debugNav("history step", { by, address });
    // Go straight to the address this history holds: a freshly reloaded frame has no browser history of its own to step through.
    navigatePreview({ action: "to", path: address }, address, () => { setPreviewPath(address); setNavNonce((n) => n + 1); }, false);
  }, [editing, navigatePreview]);
  const previewNav = useMemo(() => ({
    canBack: !editing && canBack(history), canForward: !editing && canForward(history),
    back: () => go(-1), forward: () => go(1),
  }), [history, go, editing]);
  const { page: previewPage, loading: previewPageLoading, registrable: previewRegistrable } = usePreviewPage(previewLocation?.path ?? null, previewLocation?.notFound);
  const drawing = useDrawing({ device, path: previewLocation?.path ?? null });
  const refs = useChatReferences();
  const chatDraft = useChatDraft();

  const value = useMemo<DesignChat>(() => ({
    waitProgress, requestRetry,
    previewDestination, previewNavigating,
    chatDraft,
    mode,
    state, offline, refreshSoon, retryNow, preview, device, setDevice, boxRef, editBoxRef,
    inFull: full || coverFull, coverFull, toggleFull, workingPage, selectPage, clearWorkingPage,
    editing, startEditing, stopEditing, previewLocation, previewPage, previewPageLoading, previewRegistrable, drawing, objectOpen, openObject, closeObject, returnTo, refs, previewNav, reviewOpen, setReviewOpen, showPreviewPath,
  }), [previewDestination, previewNavigating, waitProgress, chatDraft, reviewOpen, showPreviewPath, mode, refs, previewNav, objectOpen, returnTo, openObject, closeObject, previewLocation, previewPage, previewPageLoading, previewRegistrable, state, offline, refreshSoon, retryNow, preview, device, full, coverFull, toggleFull, workingPage, selectPage, clearWorkingPage, editing, startEditing, stopEditing, drawing]);

  return <Ctx.Provider value={value}><ManifestReceiverFrame />{children}</Ctx.Provider>;
}

/** The design chat's state. Only works inside <DesignChatProvider>. */
export function useDesignChat(): DesignChat {
  const v = useContext(Ctx);
  if (!v) throw new Error("useDesignChat needs <DesignChatProvider> around it.");
  return v;
}

/** Same, but returns null outside the provider, for screens that can also be shown without the chat. */
export function useDesignChatOptional(): DesignChat | null {
  return useContext(Ctx);
}
