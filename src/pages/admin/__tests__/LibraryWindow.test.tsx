import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import LibraryWindow from "../LibraryWindow";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("mounts nearby cards and releases them again without losing their place", () => {
  let notify: ((entries: { isIntersecting: boolean }[]) => void) | undefined;
  const disconnect = vi.fn();
  vi.stubGlobal("IntersectionObserver", class { constructor(cb: typeof notify) { notify = cb; } observe() {} disconnect = disconnect; });
  const card = vi.fn(() => <span>Card content</span>);
  render(<LibraryWindow kind="image">{card}</LibraryWindow>);
  expect(card).not.toHaveBeenCalled();
  act(() => notify?.([{ isIntersecting: true }]));
  expect(screen.getByText("Card content")).toBeInTheDocument();
  act(() => notify?.([{ isIntersecting: false }]));
  expect(screen.queryByText("Card content")).toBeNull();
  cleanup(); expect(disconnect).toHaveBeenCalledOnce();
});
it("retains parent-owned selection when a grid card is released and restored", () => {
  let notify: ((entries: { isIntersecting: boolean }[]) => void) | undefined;
  vi.stubGlobal("IntersectionObserver", class { constructor(cb: typeof notify) { notify = cb; } observe() {} disconnect() {} });
  const selected = new Set(["image-1"]);
  render(<LibraryWindow kind="image" grid>{() => <input type="checkbox" aria-label="Select Image" checked={selected.has("image-1")} readOnly />}</LibraryWindow>);
  act(() => notify?.([{ isIntersecting: true }])); expect(screen.getByRole("checkbox")).toBeChecked();
  act(() => notify?.([{ isIntersecting: false }])); expect(screen.queryByRole("checkbox")).toBeNull();
  act(() => notify?.([{ isIntersecting: true }])); expect(screen.getByRole("checkbox")).toBeChecked();
});