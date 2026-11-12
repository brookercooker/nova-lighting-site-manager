import { useSyncExternalStore } from "react";
import type { LinkClick } from "./linkCheck";

/** Session-only walkthrough progress, outside any component so it survives the dialog closing for View Page. */
export type WalkStep = "pages" | "links" | "checklist";
export type Checking = { key: string; kind: "page" | "link"; name: string } | null;
export type WalkState = {
  open: boolean; host: string | null; step: WalkStep;
  viewed: string[]; ticked: string[]; linkOpened: string[]; linkTicked: string[]; checks: string[];
  checking: Checking;
  approvals: Record<string, string>; linkApprovals: Record<string, string>; changed: string[];
  /** Per-page "Check this page" ticks, valid only for the page fingerprint they were made against. */
  pageChecks: Record<string, { fp: string; ids: string[] }>;
  /** Links marked "This Isn't Right", with the link fingerprint at the time. */
  linkWrong: Record<string, string>;
  /** The Check This Link window, with the page it was clicked on. */
  linkCheck: (LinkClick & { page: string | null }) | null;
};
const initial = (): WalkState => ({ open: false, host: null, step: "pages", viewed: [], ticked: [], linkOpened: [], linkTicked: [], checks: [], checking: null, approvals: {}, linkApprovals: {}, changed: [], pageChecks: {}, linkWrong: {}, linkCheck: null });
let state = initial();
const listeners = new Set<() => void>();
const hosts = new Map<string, boolean>();
const emit = () => listeners.forEach((l) => l());

export const walk = {
  get: () => state,
  update(fn: (s: WalkState) => WalkState) { state = fn(state); emit(); },
  subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; },
  mount(id: string, fallback: boolean) { hosts.set(id, fallback); return () => { hosts.delete(id); }; },
  open(id: string) { walk.update((s) => ({ ...s, open: true, host: id, checking: null })); },
  close() { walk.update((s) => ({ ...s, open: false })); },
  keepEditing() { walk.update(s => ({ ...s, open: false, checking: null, step: "pages", linkCheck: null })); },
  tickPageCheck(key: string, fp: string, id: string, on: boolean) {
    walk.update(s => ({ ...s, pageChecks: { ...s.pageChecks, [key]: { fp, ids: toggle(pageCheckIds(s, key, fp), id, on) } } }));
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
  reconcile(pages: Record<string, string>, links?: Record<string, string>) {
    const invalid = Object.entries(state.approvals).filter(([k,v]) => pages[k] !== v).map(([k]) => k);
    const badLinks = links ? Object.entries(state.linkApprovals).filter(([k,v]) => links[k] !== v).map(([k]) => k) : [];
    const staleChecks = Object.entries(state.pageChecks).filter(([k, v]) => pages[k] !== v.fp).map(([k]) => k);
    const fixedLinks = links ? Object.entries(state.linkWrong).filter(([k, v]) => links[k] !== v).map(([k]) => k) : [];
    if (!invalid.length && !badLinks.length && !staleChecks.length && !fixedLinks.length) return;
    walk.update(s => ({ ...s,
      pageChecks: Object.fromEntries(Object.entries(s.pageChecks).filter(([k]) => !staleChecks.includes(k))),
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
export const pageCheckIds = (s: WalkState, key: string, fp: string): string[] => s.pageChecks[key]?.fp === fp ? s.pageChecks[key].ids : [];
export const add = (list: string[], key: string) => (list.includes(key) ? list : [...list, key]);
export const toggle = (list: string[], key: string, on: boolean) => (on ? add(list, key) : list.filter((k) => k !== key));
export function useWalk(): WalkState { return useSyncExternalStore(walk.subscribe, walk.get, walk.get); }
