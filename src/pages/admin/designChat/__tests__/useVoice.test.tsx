import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useVoice } from "../useVoice";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function setup() {
  const recognition = { start: vi.fn(), stop: vi.fn(), abort: vi.fn(), onerror: (_ev: { error: string }) => {}, onend: () => {} };
  vi.stubGlobal("SpeechRecognition", function () { return recognition; });
  const say = vi.fn();
  const hook = renderHook(() => useVoice(() => "", vi.fn(), say));
  act(() => hook.result.current.toggle());
  return { ...hook, recognition, say };
}

it("keeps the blocked microphone message after onend and clears normally on the next run", () => {
  const { result, recognition, say } = setup();
  expect(say).toHaveBeenLastCalledWith("Listening…", false, 0);
  act(() => recognition.onerror({ error: "not-allowed" }));
  act(() => recognition.onend());
  expect(say).toHaveBeenLastCalledWith("The microphone is blocked. Allow it in your browser's address bar, then try again.", true);
  expect(result.current.listening).toBe(false);
  act(() => result.current.toggle());
  expect(say).toHaveBeenLastCalledWith("Listening…", false, 0);
  act(() => result.current.stop());
  expect(recognition.stop).toHaveBeenCalledOnce();
  act(() => recognition.onend());
  expect(say).toHaveBeenLastCalledWith("");
});

it("clears Listening on a normal stop without an error", () => {
  const { result, recognition, say } = setup();
  expect(result.current.listening).toBe(true);
  act(() => result.current.stop());
  expect(recognition.stop).toHaveBeenCalledOnce();
  act(() => recognition.onend());
  expect(result.current.listening).toBe(false);
  expect(say).toHaveBeenLastCalledWith("");
});