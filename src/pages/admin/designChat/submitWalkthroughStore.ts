import { useSyncExternalStore } from "react";
import { normPath, type ChangedRow, type LinkGroup, type ReviewLink } from "./submitWalkthrough";

/** How long after Change This Link a refetched page keeps its approvals (re-pinned to the new fingerprint). */
export const REPIN_MS = 120_000;

/** Session-only walkthrough progress, outside any component so it survives the dialog closing for View Page. */
/** The return point of Change This Link: which link is being replaced by hand, and whether a save happened. */
export type LinkFix = { key: string; fingerprint: string; href?: string; path: string; pageName: string; address: string; saved: boolean; returning?: boolean };
export type WalkStep = "pages" | "links" | "checklist";
export type Checking = { key: string; kind: "page" | "link"; name: string } | null;
export type WalkState = {
  reviewEdit: { link: ReviewLink; group: LinkGroup; rows: ChangedRow[]; fingerprint: string } | null;
  savedReviewLinks: { path: string; link: ReviewLink }[];
  /** Actual verification-tab clicks only, keyed by link key and its own fingerprint. */
  verificationOpened: Record<string, string>;
  /** Explicit exceptions for missing pages, tied to the link's own fingerprint. */
  keptMissing: Record<string, string>;
  open: boolean; host: string | null; step: WalkStep;
  viewed: string[]; ticked: string[]; linkOpened: string[]; linkTicked: string[]; checks: string[];
  checking: Checking;
  approvals: Record<string, string>; linkApprovals: Record<string, string>; changed: string[];
  selectedLink: { key: string; sequence: number } | null;
  linkNote: string | null;
  /** Set by each Submit opening; consumed by the one automatic open of the first changed page. */
  autoOpen: boolean;
  /** Wrong links the reviewer replaced by hand in Manual Edit Mode, with the link fingerprint at the time. */
  linkReplaced: Record<string, string>;
  /** Set while Change This Link is open in Manual Edit Mode; cleared by Keep Editing and normal mode exits. */
  fix: LinkFix | null;
  /** The page just saved through Change This Link: its page approval follows the hand save; links always retain their own fingerprints. */
  repin: { path: string; until: number } | null;
};
const initial = (): WalkState => ({ keptMissing: {}, verificationOpened: {}, reviewEdit: null, savedReviewLinks: [], open: false, host: null, step: "pages", viewed: [], ticked: [], linkOpened: [], linkTicked: [], checks: [], checking: null, approvals: {}, linkApprovals: {}, changed: [], selectedLink: null, linkNote: null, autoOpen: false, linkReplaced: {}, fix: null, repin: null });
export const WALK_SESSION_KEY = "nova-review-progress-v1";
const progressFields = ["approvals", "linkApprovals", "verificationOpened", "linkReplaced", "keptMissing"] as const;
function readProgress(): WalkState {
  const next = initial();
  try {
    const saved = JSON.parse(sessionStorage.getItem(WALK_SESSION_KEY) ?? "null");
    if (saved?.v !== 1) return next;
    for (const field of progressFields) if (saved[field] && typeof saved[field] === "object" && !Array.isArray(saved[field]))
      next[field] = Object.fromEntries(Object.entries(saved[field]).filter(([k, v]) => k.length <= 4096 && typeof v === "string" && v.length <= 100_000).slice(0, 500)) as Record<string, string>;
    next.ticked = Object.keys(next.approvals); next.viewed = [...next.ticked]; next.linkTicked = Object.keys(next.linkApprovals);
  } catch { /* unavailable or older storage never blocks review */ }
  return next;
}
let state = readProgress();
const listeners = new Set<() => void>();
const hosts = new Map<string, boolean>();
const emit = () => {
  try { sessionStorage.setItem(WALK_SESSION_KEY, JSON.stringify({ v: 1, ...Object.fromEntries(progressFields.map(f => [f, state[f]])) })); } catch { /* optional tab-session storage */ }
  listeners.forEach((l) => l());
};

export const walk = {
  get: () => state,
  update(fn: (s: WalkState) => WalkState) { const legacy = fn(state) as WalkState & { linkWrong?: unknown }; const { linkWrong: _ignored, ...next } = legacy; state = next.checking && next.autoOpen ? { ...next, autoOpen: false } : next; emit(); },
  subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; },
  mount(id: string, fallback: boolean) { hosts.set(id, fallback); return () => { hosts.delete(id); }; },
  open(id: string) { walk.update((s) => ({ ...s, open: true, host: id, checking: null, autoOpen: true })); },
  close() { walk.update((s) => ({ ...s, open: false })); },
  keepEditing() { walk.update(s => ({ ...s, open: false, checking: null, step: "pages", selectedLink: null, linkNote: null, fix: null, reviewEdit: null })); },
  editLink(edit: NonNullable<WalkState["reviewEdit"]>) { walk.update(s => ({ ...s, reviewEdit: edit, selectedLink: null, linkNote: null, step: "links" })); },
  selectLink(key: string | null) { walk.update(s => ({ ...s, open: true, step: "links", selectedLink: key ? { key, sequence: (s.selectedLink?.sequence ?? 0) + 1 } : null, linkNote: key ? null : "This link wasn't changed, so it doesn't need checking." })); },
  openedVerification(key: string, fingerprint: string) { walk.update(s => ({ ...s, verificationOpened: { ...s.verificationOpened, [key]: fingerprint } })); },
  keepMissing(key: string, own: string, fingerprint: string) {
    if (state.verificationOpened[key] !== own) return;
    walk.update(s => ({ ...s, keptMissing: { ...s.keptMissing, [key]: own } }));
    walk.confirmLink(key, fingerprint, true);
  },
  savedLink(path: string, link: ReviewLink) {
    const edit = state.reviewEdit;
    if (!edit) return;
    walk.update(s => ({ ...s, reviewEdit: null, repin: { path: normPath(path), until: Date.now() + REPIN_MS },
      verificationOpened: Object.fromEntries(Object.entries(s.verificationOpened).filter(([k]) => k !== edit.link.key && k !== link.key)),
      keptMissing: Object.fromEntries(Object.entries(s.keptMissing).filter(([k]) => k !== edit.link.key && k !== link.key)),
      linkTicked: s.linkTicked.filter(k => k !== edit.link.key && k !== link.key),
      linkApprovals: Object.fromEntries(Object.entries(s.linkApprovals).filter(([k]) => k !== edit.link.key && k !== link.key)),
      linkReplaced: { ...s.linkReplaced, [edit.link.key]: edit.fingerprint },
      savedReviewLinks: [...s.savedReviewLinks.filter(x => x.link.key !== link.key), { path, link }] }));
  },
  /** Change This Link: remember the return point (step "links", which link) and close the walkthrough. */
  startFix(fix: Omit<LinkFix, "saved" | "returning">) { walk.update(s => ({ ...s, open: false, checking: null, selectedLink: null, linkNote: null, step: "links", fix: { ...fix, saved: false } })); },
  fixSaved() { if (state.fix && !state.fix.saved) walk.update(s => s.fix ? { ...s, fix: { ...s.fix, saved: true } } : s); },
  fixReturning(on: boolean) { if (state.fix) walk.update(s => s.fix ? { ...s, fix: { ...s.fix, returning: on } } : s); },
  /** Leaving Manual Edit Mode some other way (or cancelled entry): forget the return point, change nothing else. */
  clearFix() { if (state.fix) walk.update(s => ({ ...s, fix: null })); },
  /** Back to Review: after a save the link becomes Replaced by Hand; without one its approval stays unchanged. Reopens on the Links step. */
  finishFix() {
    const fix = state.fix;
    walk.update(s => {
      if (!fix?.saved) return { ...s, fix: null };
      const linkApprovals = { ...s.linkApprovals }; delete linkApprovals[fix.key];
      return { ...s, fix: null, verificationOpened: Object.fromEntries(Object.entries(s.verificationOpened).filter(([k]) => k !== fix.key)), repin: { path: normPath(fix.path), until: Date.now() + REPIN_MS }, linkApprovals, linkTicked: s.linkTicked.filter(k => k !== fix.key), linkReplaced: { ...s.linkReplaced, [fix.key]: fix.fingerprint } };
    });
    walk.reopen("links");
  },
  /** Tick or untick a changed link in its review row. */
  confirmLink(key: string, fingerprint: string, on: boolean) {
    walk.update(s => {
      const linkApprovals = { ...s.linkApprovals }; if (on) linkApprovals[key] = fingerprint; else delete linkApprovals[key];
      const keptMissing = { ...s.keptMissing }; if (!on) delete keptMissing[key];
      return { ...s, keptMissing, linkApprovals, linkTicked: toggle(s.linkTicked, key, on), linkOpened: add(s.linkOpened, key), changed: s.changed.filter(k => k !== key) };
    });
  },
  approve(key: string, fingerprint: string, link = false) {
    walk.update(s => {
      const field = link ? "linkApprovals" : "approvals";
      const ticks = link ? "linkTicked" : "ticked";
      const approved = s[ticks].includes(key);
      const map = { ...s[field] }; if (approved) delete map[key]; else map[key] = fingerprint;
      return { ...s, [field]: map, [ticks]: toggle(s[ticks], key, !approved), changed: s.changed.filter(k => k !== key) };
    });
  },
  /** `links` and `own` use each link’s destination, target and identity; never repin link decisions after a page save. */
  reconcile(pages: Record<string, string>, links?: Record<string, string>, own?: Record<string, string>) {
    const pin = state.repin && state.repin.until > Date.now() ? state.repin.path : null;
    if (state.repin && !pin) state = { ...state, repin: null };
    if (pin) {
      const pinned = (k: string) => k === "page:" + pin || (k.includes("|") && normPath(k.split("|")[0] || "/") === pin);
      const pg = Object.entries(state.approvals).filter(([k, v]) => pinned(k) && pages[k] && pages[k] !== v);
      if (pg.length) state = { ...state, repin: null,
        approvals: { ...state.approvals, ...Object.fromEntries(pg.map(([k]) => [k, pages[k]])) } };
    }
    const invalid = Object.entries(state.approvals).filter(([k,v]) => pages[k] !== v).map(([k]) => k);
    const badLinks = links ? Object.entries(state.linkApprovals).filter(([k,v]) => links[k] !== v).map(([k]) => k) : [];
    const staleReplaced = own ? Object.entries(state.linkReplaced).filter(([k, v]) => own[k] !== v).map(([k]) => k) : [];
    const staleOpened = own ? Object.entries(state.verificationOpened).filter(([k, v]) => own[k] !== v).map(([k]) => k) : [];
    const staleKept = own ? Object.entries(state.keptMissing).filter(([k, v]) => own[k] !== v).map(([k]) => k) : [];
    if (!invalid.length && !badLinks.length && !staleReplaced.length && !staleOpened.length && !staleKept.length) return;
    walk.update(s => ({ ...s,
      keptMissing: Object.fromEntries(Object.entries(s.keptMissing).filter(([k]) => !staleKept.includes(k))),
      verificationOpened: Object.fromEntries(Object.entries(s.verificationOpened).filter(([k]) => !staleOpened.includes(k))),
      linkReplaced: Object.fromEntries(Object.entries(s.linkReplaced).filter(([k]) => !staleReplaced.includes(k))),
      ticked: s.ticked.filter(k => !invalid.includes(k)), viewed: s.viewed.filter(k => !invalid.includes(k)),
      linkTicked: s.linkTicked.filter(k => !badLinks.includes(k)), linkOpened: s.linkOpened.filter(k => !badLinks.includes(k)),
      approvals: Object.fromEntries(Object.entries(s.approvals).filter(([k]) => !invalid.includes(k))), linkApprovals: Object.fromEntries(Object.entries(s.linkApprovals).filter(([k]) => !badLinks.includes(k))),
      changed: [...new Set([...s.changed, ...invalid, ...badLinks])] }));
  },
  /** Reopen from the preview bar in the dialog that opened it, or a host that is still mounted. */
  reopen(step?: WalkStep) {
    const host = state.host && hosts.has(state.host) ? state.host
      : [...hosts].find(([, f]) => f)?.[0] ?? [...hosts.keys()][0] ?? null;
    walk.update((s) => ({ ...s, open: true, host, checking: null, step: step ?? s.step }));
  },
  /** After a successful submit or an empty draft. */
  reset() { state = initial(); emit(); },
  /** Reload only persisted fingerprinted progress, never dialogs or unfinished editing. */
  restoreSession() { state = readProgress(); emit(); },
};
export const add = (list: string[], key: string) => (list.includes(key) ? list : [...list, key]);
export const toggle = (list: string[], key: string, on: boolean) => (on ? add(list, key) : list.filter((k) => k !== key));
export function useWalk(): WalkState { return useSyncExternalStore(walk.subscribe, walk.get, walk.get); }
