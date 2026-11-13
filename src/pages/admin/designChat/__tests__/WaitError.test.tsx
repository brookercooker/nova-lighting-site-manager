import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import WaitProgress from "../WaitProgress";
import StageRibbon from "../StageRibbon";
import { useWaitProgress } from "../useWaitProgress";
afterEach(() => { cleanup(); sessionStorage.clear(); vi.useRealTimers(); });
it.each([WaitProgress, StageRibbon])("dismiss clears the failed indicator without touching relay state", Surface => {
  const state = { busy: false, job: { kind: "change", status: "failed", startedAt: 1000 }, history: [], previewVersion: 1 };
  function ErrorSurface() {
    const { request } = useWaitProgress(state);
    return <Surface thin progress={request} />;
  }
  render(<ErrorSurface />);
  fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
  expect(screen.queryByRole("status")).toBeNull();
  expect(state.job.status).toBe("failed");
  expect(state.busy).toBe(false);
});
it.each([WaitProgress, StageRibbon])("shares hover/focus pause, retry and dismissal in every error surface", Surface => {
  vi.useFakeTimers(); vi.setSystemTime(10000);
  const retry = vi.fn();
  function ErrorSurface() {
    const { request } = useWaitProgress({ busy: false, job: { kind: "change", status: "failed", startedAt: 1000 }, history: [], previewVersion: 1 });
    return <Surface thin progress={request && { ...request, errorControls: request.errorControls && { ...request.errorControls, retry } }} />;
  }
  render(<ErrorSurface />);
  const status = screen.getByRole("status"); fireEvent.mouseEnter(status);
  act(() => vi.advanceTimersByTime(13000)); expect(screen.getByRole("button", { name: "Try Again" })).toBeVisible();
  act(() => screen.getByRole("button", { name: "Try Again" }).focus()); fireEvent.mouseLeave(status);
  act(() => vi.advanceTimersByTime(13000)); expect(screen.getByRole("status")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Try Again" })); expect(retry).toHaveBeenCalledOnce();
  act(() => screen.getByRole("button", { name: "Try Again" }).blur());
  act(() => vi.advanceTimersByTime(12000)); expect(screen.getByRole("status")).toHaveClass("opacity-0");
  act(() => vi.advanceTimersByTime(250)); expect(screen.queryByRole("status")).toBeNull();
});