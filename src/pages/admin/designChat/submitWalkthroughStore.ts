import { useSyncExternalStore } from "react";

/** Session-only walkthrough progress, outside any component so it survives the dialog closing for View Page. */
export type WalkStep = "pages" | "links" | "checklist";
export type Checking = { key: string; kind: "page" | "link"; name: string } | null;
export type WalkState = {
  open: boolean; host: string | null; step: WalkStep;
  viewed: string[]; ticked: string[]; linkOpened: string[]; linkTicked: string[]; checks: string[];
  checking: Checking;
};
const initial = (): WalkState => ({ open: false, host: null, step: "pages", viewed: [], ticked: [], linkOpened: [], linkTicked: [], checks: [], checking: null });
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
