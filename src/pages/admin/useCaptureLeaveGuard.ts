import { useContext, useEffect } from "react";
import { UNSAFE_NavigationContext } from "react-router-dom";

/** BrowserRouter navigation plus reload/tab close; staged Files are deliberately never stored in browser storage. */
export function useCaptureLeaveGuard(staged: boolean) {
  const { navigator } = useContext(UNSAFE_NavigationContext);
  useEffect(() => {
    if (!staged) return;
    const allowed = () => window.confirm("Leave without uploading? Your staged photos and videos will be removed.");
    let index = window.history.state?.idx ?? 0;
    let restoring = false;
    const pop = (event: PopStateEvent) => {
      const next = event.state?.idx ?? index;
      if (restoring) { restoring = false; event.stopImmediatePropagation(); return; }
      if (next !== index && !allowed()) {
        event.stopImmediatePropagation();
        restoring = true;
        window.history.go(index - next);
      } else index = next;
    };
    const push = navigator.push, replace = navigator.replace, go = navigator.go;
    navigator.push = (...args) => { if (allowed()) push.apply(navigator, args); };
    navigator.replace = (...args) => { if (allowed()) replace.apply(navigator, args); };
    navigator.go = (...args) => { if (allowed()) go.apply(navigator, args); };
    const unload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", unload);
    window.addEventListener("popstate", pop, true);
    return () => {
      navigator.push = push; navigator.replace = replace; navigator.go = go;
      window.removeEventListener("beforeunload", unload);
      window.removeEventListener("popstate", pop, true);
    };
  }, [navigator, staged]);
}