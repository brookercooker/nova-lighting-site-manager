import { useSyncExternalStore } from "react";
import type { LinkClick } from "./linkCheck";
import { normPath } from "./submitWalkthrough";

/** How long after Change This Link a refetched page keeps its approvals (re-pinned to the new fingerprint). */
export const REPIN_MS = 120_000;

/** Session-only walkthrough progress, outside any component so it survives the dialog closing for View Page. */
/** The return point of Change This Link: which wrong link is being replaced by hand, and whether a save happened. */
export type LinkFix = { key: string; fingerprint: string; href?: string; path: string; pageName: string; address: string; saved: boolean; returning?: boolean };
export type WalkStep = "pages" | "links" | "checklist";
export type Checking = { key: string; kind: "page" | "link"; name: string } | null;
export type WalkState = {
  open: boolean; host: string | null; step: WalkStep;
  viewed: string[]; ticked: string[]; linkOpened: string[]; linkTicked: string[]; checks: string[];
  checking: Checking;
  approvals: Record<string, string>; linkApprovals: Record<string, string>; changed: string[];
  /** Links marked "This Isn't Right", with the link fingerprint at the time. */
  linkWrong: Record<string, string>;
  /** The Check This Link window, with the page it was clicked on. */
  linkCheck: (LinkClick & { page: string | null }) | null;
  /** Set by each Submit opening; consumed by the one automatic open of the first changed page. */
  autoOpen: boolean;
  /** Wrong links the reviewer replaced by hand in Manual Edit Mode, with the link fingerprint at the time. */
  linkReplaced: Record<string, string>;
  /** Set while Change This Link is open in Manual Edit Mode; cleared by Keep Editing and normal mode exits. */
  fix: LinkFix | null;
  /** The page just saved through Change This Link: its approval and confirmed links follow the hand save instead of resetting. */
  repin: { path: string; until: number } | null;
};
const initial = (): WalkState => ({ open: false, host: null, step: "pages", viewed: [], ticked: [], linkOpened: [], linkTicked: [], checks: [], checking: null, approvals: {}, linkApprovals: {}, changed: [], linkWrong: {}, linkCheck: null, autoOpen: false, linkReplaced: {}, fix: null, repin: null });
let state = initial();
const listeners = new Set<() => void>();
const hosts = new Map<string, boolean>();
const emit = () => listeners.forEach((l) => l());

export const walk = {
  get: () => state,
  update(fn: (s: WalkState) => WalkState) { const next = fn(state); state = next.checking && next.autoOpen ? { ...next, autoOpen: false } : next; emit(); },
  subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; },
  mount(id: string, fallback: boolean) { hosts.set(id, fallback); return () => { hosts.delete(id); }; },
  open(id: string) { walk.update((s) => ({ ...s, open: true, host: id, checking: null, autoOpen: true })); },
  close() { walk.update((s) => ({ ...s, open: false })); },
  keepEditing() { walk.update(s => ({ ...s, open: false, checking: null, step: "pages", linkCheck: null, fix: null })); },
  /** Change This Link: remember the return point (step "links", which link) and close the walkthrough. */
  startFix(fix: Omit<LinkFix, "saved" | "returning">) { walk.update(s => ({ ...s, open: false, checking: null, linkCheck: null, step: "links", fix: { ...fix, saved: false } })); },
  fixSaved() { if (state.fix && !state.fix.saved) walk.update(s => s.fix ? { ...s, fix: { ...s.fix, saved: true } } : s); },
  fixReturning(on: boolean) { if (state.fix) walk.update(s => s.fix ? { ...s, fix: { ...s.fix, returning: on } } : s); },
  /** Leaving Manual Edit Mode some other way (or cancelled entry): forget the return point, change nothing else. */
  clearFix() { if (state.fix) walk.update(s => ({ ...s, fix: null })); },
  /** Back to Review: after a save the link becomes Replaced by Hand; without one it stays wrong. Reopens on the Links step. */
  finishFix() {
    const fix = state.fix;
    walk.update(s => {
      if (!fix?.saved) return { ...s, fix: null };
      const linkWrong = { ...s.linkWrong }; delete linkWrong[fix.key];
      const linkApprovals = { ...s.linkApprovals }; delete linkApprovals[fix.key];
      return { ...s, fix: null, repin: { path: normPath(fix.path), until: Date.now() + REPIN_MS }, linkWrong, linkApprovals, linkTicked: s.linkTicked.filter(k => k !== fix.key), linkReplaced: { ...s.linkReplaced, [fix.key]: fix.fingerprint } };
    });
    walk.reopen("links");
  },
  /** Confirm (or unconfirm) a changed link from the Check This Link window; counts like the Links step's approval. */
  confirmLink(key: string, fingerprint: string, on: boolean) {
    walk.update(s => {
      const linkApprovals = { ...s.linkApprovals }; if (on) linkApprovals[key] = fingerprint; else delete linkApprovals[key];
      const linkWrong = { ...s.linkWrong }; if (on) delete linkWrong[key];
      return { ...s, linkApprovals, linkWrong, linkTicked: toggle(s.linkTicked, key, on), linkOpened: add(s.linkOpened, key), changed: s.changed.filter(k => k !== key) };
    });
  },
  markWrong(key: string, fingerprint: string) {
    walk.update(s => {
      const linkApprovals = { ...s.linkApprovals }; delete linkApprovals[key];
      return { ...s, linkApprovals, linkWrong: { ...s.linkWrong, [key]: fingerprint }, linkTicked: s.linkTicked.filter(k => k !== key), linkOpened: add(s.linkOpened, key) };
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
  /** `own` is each link's own fingerprint (key, address, requests); Replaced by Hand uses it because hand saves change the page-level link fingerprint. */
  reconcile(pages: Record<string, string>, links?: Record<string, string>, own?: Record<string, string>) {
    const pin = state.repin && state.repin.until > Date.now() ? state.repin.path : null;
    if (state.repin && !pin) state = { ...state, repin: null };
    if (pin) {
      const pinned = (k: string) => k === "page:" + pin || (k.includes("|") && normPath(k.split("|")[0] || "/") === pin);
      const pg = Object.entries(state.approvals).filter(([k, v]) => pinned(k) && pages[k] && pages[k] !== v);
      const ln = links ? Object.entries(state.linkApprovals).filter(([k, v]) => pinned(k) && links[k] && links[k] !== v) : [];
      if (pg.length || ln.length) state = { ...state, repin: null,
        approvals: { ...state.approvals, ...Object.fromEntries(pg.map(([k]) => [k, pages[k]])) },
        linkApprovals: { ...state.linkApprovals, ...Object.fromEntries(ln.map(([k]) => [k, links![k]])) } };
    }
    const invalid = Object.entries(state.approvals).filter(([k,v]) => pages[k] !== v).map(([k]) => k);
    const badLinks = links ? Object.entries(state.linkApprovals).filter(([k,v]) => links[k] !== v).map(([k]) => k) : [];
    const fixedLinks = links ? Object.entries(state.linkWrong).filter(([k, v]) => links[k] !== v).map(([k]) => k) : [];
    const staleReplaced = own ? Object.entries(state.linkReplaced).filter(([k, v]) => own[k] !== v).map(([k]) => k) : [];
    if (!invalid.length && !badLinks.length && !fixedLinks.length && !staleReplaced.length) return;
    walk.update(s => ({ ...s,
      linkReplaced: Object.fromEntries(Object.entries(s.linkReplaced).filter(([k]) => !staleReplaced.includes(k))),
      linkWrong: Object.fromEntries(Object.entries(s.linkWrong).filter(([k]) => !fixedLinks.includes(k))), ticked: s.ticked.filter(k => !invalid.includes(k)), viewed: s.viewed.filter(k => !invalid.includes(k)),
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
};
export const add = (list: string[], key: string) => (list.includes(key) ? list : [...list, key]);
export const toggle = (list: string[], key: string, on: boolean) => (on ? add(list, key) : list.filter((k) => k !== key));
export function useWalk(): WalkState { return useSyncExternalStore(walk.subscribe, walk.get, walk.get); }
