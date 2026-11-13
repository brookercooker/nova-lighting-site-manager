import { useState } from "react";
import type { LabelScope } from "./useAllLabels";

export type LibraryView = "list" | "grid";
export const libraryViewKey = (scope: LabelScope) => `nova:library-view:${scope}`;
export const defaultLibraryView = (scope: LabelScope): LibraryView => scope === "static" || scope === "landing" ? "list" : "grid";
export function readLibraryView(scope: LabelScope): LibraryView {
  try {
    const stored = localStorage.getItem(libraryViewKey(scope));
    if (stored === "list" || stored === "grid") return stored;
  } catch { /* Optional preference storage. */ }
  return defaultLibraryView(scope);
}
export function useLibraryView(scope: LabelScope) {
  const [view, setView] = useState<LibraryView>(() => readLibraryView(scope));
  const changeView = (next: LibraryView) => {
    setView(next);
    try { localStorage.setItem(libraryViewKey(scope), next); } catch { /* Keep the in-memory choice. */ }
  };
  return [view, changeView] as const;
}