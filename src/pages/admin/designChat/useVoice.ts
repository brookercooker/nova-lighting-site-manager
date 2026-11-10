import { useCallback, useEffect, useRef, useState } from "react";

/** Speaking instead of typing. Uses the browser's own speech recognition, so it is only offered where the browser has it. */
export function useVoice(getText: () => string, setText: (t: string) => void, say: (text?: string, bad?: boolean, ms?: number) => void) {
  const SR: any = typeof window !== "undefined" ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition : undefined;
  const supported = Boolean(SR);
  const [listening, setListening] = useState(false);
  const rec = useRef<any>(null);
  const base = useRef("");
  const on = useRef(false);
  const errorShown = useRef(false);

  useEffect(() => () => { try { rec.current?.abort?.(); } catch { /* already stopped */ } }, []);

  const toggle = useCallback(() => {
    if (!SR) return;
    if (on.current) { rec.current?.stop(); return; }
    if (!rec.current) {
      const r = new SR();
      r.continuous = true;
      r.interimResults = true;
      r.lang = navigator.language || "en-US";
      r.onresult = (ev: any) => {
        let said = "";
        for (let i = 0; i < ev.results.length; i++) said += ev.results[i][0].transcript;
        setText(base.current + said);
      };
      r.onend = () => { on.current = false; setListening(false); if (!errorShown.current) say(""); };
      r.onerror = (ev: any) => {
        const why = ev.error;
        if (why !== "no-speech" && why !== "aborted") errorShown.current = true;
        if (why === "not-allowed" || why === "service-not-allowed") say("The microphone is blocked. Allow it in your browser's address bar, then try again.", true);
        else if (why === "audio-capture") say("No microphone was found.", true);
        else if (why === "network") say("Voice input needs an internet connection.", true);
        else if (why !== "no-speech" && why !== "aborted") say("Voice input stopped. Try again.", true);
      };
      rec.current = r;
    }
    const current = getText();
    base.current = current && !/\s$/.test(current) ? `${current} ` : current;
    errorShown.current = false;
    try { rec.current.start(); } catch { return; }
    on.current = true;
    setListening(true);
    say("Listening…", false, 0);
  }, [SR, getText, setText, say]);

  /** Stop listening (before sending, say). */
  const stop = useCallback(() => { if (on.current) rec.current?.stop(); }, []);
  return { supported, listening, toggle, stop };
}
