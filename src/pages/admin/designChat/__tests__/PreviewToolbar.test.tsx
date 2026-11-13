import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import PreviewToolbar from "../PreviewToolbar";
import PreviewTools from "../PreviewTools";
import { walk } from "../submitWalkthroughStore";
const m = vi.hoisted(() => ({ chat: {} as any, phone: false, select: vi.fn(), retry: vi.fn(), full: vi.fn() }));
const pages = [{ id: "home", name: "Homepage", path: "/" }, { id: "draft", name: "Draft", path: "/draft" }];
vi.mock("../DesignChatContext", () => ({ useDesignChat: () => m.chat }));
vi.mock("../pageSelection", () => ({ loadManualPages: async () => pages }));
vi.mock("../useManagerLayout", () => ({ useManagerLayout: () => ({ phone: m.phone }) }));
beforeEach(() => {
  vi.clearAllMocks(); walk.reset(); m.phone = false;
  m.chat = { editing: false, workingPage: pages[0], previewLocation: { path: "/draft", search: "?offer=1" }, selectPage: m.select,
    preview: { retry: m.retry }, state: { liveUrl: "https://site.example/" }, toggleFull: m.full,
    previewNav: { back: vi.fn(), forward: vi.fn(), canBack: false, canForward: true } };
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
});
afterEach(() => { cleanup(); walk.reset(); });
it.each(["pages", "links", "checklist"] as const)("hides page navigation while review is on %s", step => {
  walk.update(w => ({ ...w, open: true, step }));
  render(<PreviewToolbar onManualNavigate={vi.fn()} />);
  expect(screen.queryByRole("toolbar", { name: "Preview Toolbar" })).toBeNull();
});
it("top-bar preview actions use the existing full-screen toggle and exact current page safely", () => {
  m.chat.device = "mobile"; m.chat.setDevice = vi.fn();
  const view = render(<PreviewTools showViewControls review />);
  fireEvent.click(screen.getByRole("button", { name: "Full screen preview" }));
  expect(m.full).toHaveBeenCalledOnce();
  expect(screen.getByRole("link", { name: "Open preview in new tab" })).toHaveAttribute("href", "https://site.example/draft?offer=1");
  expect(screen.getByRole("link", { name: "Open preview in new tab" })).toHaveAttribute("rel", "noopener noreferrer");
  m.chat.previewLocation = { path: "/", search: "" }; m.chat.inFull = true;
  view.rerender(<PreviewTools showViewControls review />);
  expect(screen.getByRole("button", { name: "Full screen preview" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("link", { name: "Open preview in new tab" })).toHaveAttribute("href", "https://site.example/");
});
it("shows the requested page immediately without waiting for a location report", async () => {
  m.chat.previewNav.canBack = true;
  const view = render(<PreviewToolbar onManualNavigate={vi.fn()} />);
  await waitFor(() => expect(screen.getByRole("combobox", { name: "Preview Page" })).toHaveTextContent("Draft"));
  m.chat.previewNav.back.mockImplementation(() => {
    m.chat.previewDestination = "/";
    m.chat.previewNav.canBack = false;
    m.chat.previewNav.canForward = true;
    view.rerender(<PreviewToolbar onManualNavigate={vi.fn()} />);
  });
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(screen.getByRole("combobox", { name: "Preview Page" })).toHaveTextContent("Homepage");
  expect(screen.getByRole("button", { name: "Back" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Forward" })).toBeEnabled();
  expect(screen.getByRole("link", { name: "Open Page in New Tab" })).toHaveAttribute("href", "https://site.example/");
  expect(m.chat.previewLocation.path).toBe("/draft");
});
it("uses the reported current page for opening a new tab, including after navigation", async () => {
  const view = render(<PreviewToolbar onManualNavigate={vi.fn()} />);
  expect(screen.getByRole("link", { name: "Open Page in New Tab" })).toHaveAttribute("href", "https://site.example/draft?offer=1");
  m.chat.previewLocation = { path: "/", search: "" }; view.rerender(<PreviewToolbar onManualNavigate={vi.fn()} />);
  expect(screen.getByRole("link", { name: "Open Page in New Tab" })).toHaveAttribute("href", "https://site.example/");
  fireEvent.click(screen.getByRole("button", { name: "Reload Preview" })); expect(m.retry).toHaveBeenCalledOnce();
  expect(m.select).not.toHaveBeenCalled();
});
it("uses selectPage for deliberate picks so existing tab persistence is retained", async () => {
  render(<PreviewToolbar onManualNavigate={vi.fn()} />);
  await waitFor(() => expect(screen.getByRole("combobox", { name: "Preview Page" })).toHaveTextContent("Draft"));
  fireEvent.click(screen.getByRole("combobox", { name: "Preview Page" }));
  fireEvent.click(await screen.findByRole("option", { name: "Homepage /" }));
  expect(m.select).toHaveBeenCalledWith(pages[0]);
});
it("routes manual picks through the existing unsaved guard and reloads without saving", async () => {
  m.chat.editing = true;
  const navigate = vi.fn(); const reloaded = vi.fn(); window.addEventListener("nova-manager-reload-editor", reloaded);
  try {
    render(<PreviewToolbar onManualNavigate={navigate} />);
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Preview Page" })).toHaveTextContent("Homepage"));
    fireEvent.click(screen.getByRole("combobox", { name: "Preview Page" }));
    fireEvent.click(await screen.findByRole("option", { name: "Draft /draft" }));
    expect(navigate).toHaveBeenCalledWith("/draft"); expect(m.select).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Back" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Forward" }));
    expect(navigate).toHaveBeenLastCalledWith("/draft");
    fireEvent.click(screen.getByRole("button", { name: "Reload Preview" }));
    expect(reloaded).toHaveBeenCalledOnce(); expect(m.retry).not.toHaveBeenCalled();
  } finally { window.removeEventListener("nova-manager-reload-editor", reloaded); }
});
it("keeps phone overflow actions usable with the existing callbacks", async () => {
  m.phone = true; render(<PreviewToolbar onManualNavigate={vi.fn()} />);
  fireEvent.keyDown(screen.getByRole("button", { name: "Preview Options" }), { key: "Enter" });
  fireEvent.click(await screen.findByRole("menuitem", { name: "Full Screen" }));
  expect(m.full).toHaveBeenCalledOnce();
});