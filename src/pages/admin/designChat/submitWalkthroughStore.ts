import { useSyncExternalStore } from "react";

/** Session-only walkthrough progress, outside any component so it survives the dialog closing for View Page. */
export type WalkStep = "pages" | "links" | "checklist";
export type Checking = { key: string; kind: "page" | "link"; name: string } | null;
export type WalkState = {
  open: boolean; host: string | null; step: WalkStep;
  viewed: string[]; ticked: string[]; linkOpened: string[]; linkTicked: string[]; checks: string[];
  checking: Checking;
  approvals: Record<string, string>; linkApprovals: Record<string, string>; changed: string[];
};
const initial = (): WalkState => ({ open: false, host: null, step: "pages", viewed: [], ticked: [], linkOpened: [], linkTicked: [], checks: [], checking: null, approvals: {}, linkApprovals: {}, changed: [] });
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
  keepEditing() { walk.update(s => ({ ...s, open: false, checking: null, step: "pages" })); },
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
    if (!invalid.length && !badLinks.length) return;
    walk.update(s => ({ ...s, ticked: s.ticked.filter(k => !invalid.includes(k)), viewed: s.viewed.filter(k => !invalid.includes(k)),
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
