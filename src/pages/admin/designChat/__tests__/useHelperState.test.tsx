import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { helperPollDelay, useHelperState } from "../useHelperState";
const auth = vi.hoisted(() => ({ user: true }));
vi.mock("@/lib/authGate", () => ({ hasManagerUser: async () => auth.user, SIGN_IN_REQUIRED: "Sign in to load or save this" }));

vi.mock("../helper", () => ({ RELAY: "https://relay.test", relayHeaders: async () => ({}) }));
const idle = { busy: false, job: null, previewVersion: 0, history: [] };
const success = () => Promise.resolve({ ok: true, json: async () => idle });
let visibility = "visible";
const advance = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };
const changeVisibility = async (value: string) => {
  visibility = value;
  await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
};

beforeEach(() => {
  auth.user = true;
  vi.useFakeTimers();
  visibility = "visible";
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility as DocumentVisibilityState);
  vi.stubGlobal("fetch", vi.fn(success));
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("helper polling delays", () => {
  it.each([1000, 4000])("keeps visible normal interval %s", (normal) => {
    expect(helperPollDelay(normal, false, 0)).toBe(normal);
  });
  it.each([1000, 4000])("uses 30 seconds while hidden even for interval %s", (normal) => {
    expect(helperPollDelay(normal, true, 0)).toBe(30_000);
  });
  it("doubles failures up to 60 seconds and resets after success", () => {
    expect([1, 2, 3, 4, 5, 6].map(n => helperPollDelay(4000, false, n))).toEqual([8000, 16000, 32000, 60000, 60000, 60000]);
    expect(helperPollDelay(1000, false, 1)).toBe(2000);
    expect(helperPollDelay(4000, true, 1)).toBe(60_000);
    expect(helperPollDelay(4000, false, 0)).toBe(4000);
  });
});

describe("mounted helper polling", () => {
  it.each([401, 403])("shows the sign-in note for %s and recovers at the normal interval", async (status) => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ ok: false, status } as Response);
    const { result, unmount } = renderHook(() => useHelperState(() => 4000));
    await advance(0);
    expect(result.current.offline).toBe(true);
    await advance(8000);
    expect(result.current.offline).toBe(false);
    expect(result.current.state).toEqual({ ...idle, history: [{ role: "note", text: "Sign in to load or save this" }] });
    await advance(3999);
    expect(fetch).toHaveBeenCalledTimes(2);
    await advance(1);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(result.current.state).toEqual(idle);
    unmount();
  });
  it("keeps 500 responses offline with automatic back-off", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 500 } as Response);
    const { result, unmount } = renderHook(() => useHelperState(() => 4000));
    await advance(0);
    expect(result.current.offline).toBe(true);
    expect(result.current.state).toBeNull();
    await advance(7999);
    expect(fetch).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(result.current.offline).toBe(false);
    unmount();
  });
  it.each(["manual", "online"])("bypasses the 60-second back-off on %s refresh and retains refreshSoon throttling", async (action) => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("offline"));
    const { result, unmount } = renderHook(() => useHelperState(() => 30_000));
    await advance(0);
    act(() => result.current.refreshSoon());
    await advance(1000);
    expect(fetch).toHaveBeenCalledTimes(1);
    await act(async () => {
      if (action === "manual") result.current.retryNow();
      else window.dispatchEvent(new Event("online"));
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(result.current.offline).toBe(false);
    await advance(30_000);
    expect(fetch).toHaveBeenCalledTimes(3);
    unmount();
    await act(async () => window.dispatchEvent(new Event("online")));
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it("coalesces retries during an active poll into one immediate follow-up", async () => {
    let finish: ((value: Response) => void) | undefined;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const { result, unmount } = renderHook(() => useHelperState(() => 4000));
    await advance(0);
    act(() => { result.current.retryNow(); result.current.retryNow(); window.dispatchEvent(new Event("online")); });
    expect(fetch).toHaveBeenCalledTimes(1);
    await act(async () => finish?.({ ok: false, status: 500 } as Response));
    await advance(0);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(result.current.offline).toBe(false);
    unmount();
  });
  it("shows a sign-in note without polling the protected service signed out", async () => {
    auth.user = false;
    const { result, unmount } = renderHook(() => useHelperState(() => 4000));
    await advance(0);
    expect(fetch).not.toHaveBeenCalled();
    expect(result.current.offline).toBe(false);
    expect(result.current.state?.history[0].text).toBe("Sign in to load or save this");
    unmount();
  });
  it("throttles hidden tabs including refreshSoon and immediately refreshes on visibility", async () => {
    visibility = "hidden";
    const { result, unmount } = renderHook(() => useHelperState(() => 1000));
    await advance(0);
    expect(fetch).toHaveBeenCalledTimes(1);
    act(() => result.current.refreshSoon());
    await advance(29_999);
    expect(fetch).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(fetch).toHaveBeenCalledTimes(2);
    await changeVisibility("visible");
    expect(fetch).toHaveBeenCalledTimes(3);
    await advance(1000);
    expect(fetch).toHaveBeenCalledTimes(4);
    unmount();
  });
  it.each(["network", "non-2xx"])("backs off after %s errors and resets on success", async (kind) => {
    vi.mocked(fetch)
      .mockImplementationOnce(() => kind === "network" ? Promise.reject(new Error("offline")) : Promise.resolve({ ok: false } as Response))
      .mockRejectedValueOnce(new Error("offline"));
    const { result, unmount } = renderHook(() => useHelperState(() => 4000));
    await advance(0);
    expect(result.current.offline).toBe(true);
    await advance(7999);
    expect(fetch).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(fetch).toHaveBeenCalledTimes(2);
    await advance(15_999);
    expect(fetch).toHaveBeenCalledTimes(2);
    await advance(1);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(result.current.offline).toBe(false);
    await advance(4000);
    expect(fetch).toHaveBeenCalledTimes(4);
    unmount();
  });
  it("stops polling and removes visibility handling on unmount", async () => {
    const { unmount } = renderHook(() => useHelperState(() => 4000));
    await advance(0);
    unmount();
    await advance(60_000);
    await changeVisibility("hidden");
    await changeVisibility("visible");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("aborts an outstanding request without restarting after unmount", async () => {
    let finish: ((value: Response) => void) | undefined;
    vi.mocked(fetch).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const { unmount } = renderHook(() => useHelperState(() => 4000));
    await advance(0);
    const signal = vi.mocked(fetch).mock.calls[0][1]?.signal;
    unmount();
    expect(signal?.aborted).toBe(true);
    await act(async () => { finish?.({ ok: true, json: async () => idle } as Response); });
    await advance(60_000);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});