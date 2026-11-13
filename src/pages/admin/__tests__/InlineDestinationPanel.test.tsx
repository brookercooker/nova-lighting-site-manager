import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import InlineDestinationPanel from "../InlineDestinationPanel";
import { createReplay, type InlineEdits } from "@/lib/inlineEditCore";
import type { InlineSelection } from "@/components/InlineEditSurface";
import { remoteSelection } from "../remoteSelection";
beforeEach(() => vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function setup(tag = "a", submit?: () => void) {
  const root = document.createElement("section"), el = document.createElement(tag);
  if (tag === "a") el.setAttribute("href", "/original");
  el.textContent = "Explore"; root.append(el);
  const selection: InlineSelection = { key: "0", kind: "text", el, scope: "page", ...(tag !== "h3" ? { link: { key: "0", el, scope: "page" } } : {}) };
  const change = vi.fn(), replay = createReplay(); replay.apply(root, {});
  function Panel() {
    const [edits, setEdits] = useState<InlineEdits>({});
    return <form onSubmit={e => { e.preventDefault(); submit?.(); }}><InlineDestinationPanel selection={selection} pages={[{ id: "1", name: "Lighting", path: "/lighting" }]} editsFor={() => edits} onChange={(scope, next) => { change(scope, next); setEdits(next); replay.apply(root, next); }} /></form>;
  }
  render(<Panel />); return { el, change };
}
it.each(["a", "button"])("edits %s without changing its appearance and restores/off works", (tag) => {
  const { el, change } = setup(tag), children = el.firstChild;
  const field = screen.getByRole("textbox", { name: "Link Address" });
  fireEvent.change(field, { target: { value: "/lighting" } }); fireEvent.keyDown(field, { key: "Enter" });
  expect(JSON.parse(change.mock.lastCall?.[1]["link:0"])).toEqual({ href: "/lighting" });
  fireEvent.click(screen.getByRole("switch", { name: "Open in New Tab" }));
  expect(JSON.parse(change.mock.lastCall?.[1]["link:0"])).toEqual({ href: "/lighting", target: "_blank" });
  fireEvent.focus(field); fireEvent.click(screen.getByRole("button", { name: /^None$/ }));
  expect(el.getAttribute("data-inline-link")).toBe("off"); expect(el.firstChild).toBe(children);
  fireEvent.click(screen.getByRole("button", { name: "Restore Original Link" }));
  expect(change.mock.lastCall?.[1]).toEqual({}); expect(el.getAttribute("href")).toBe(tag === "a" ? "/original" : null);
  expect(el.getAttribute("data-inline-link")).toBeNull();
});
it("does not show link tools for a heading", () => { setup("h3"); expect(screen.queryByRole("textbox", { name: "Link Address" })).toBeNull(); });
it("rejects invalid addresses without saving and applies on blur", () => {
  const { change } = setup(), field = screen.getByRole("textbox", { name: "Link Address" });
  fireEvent.change(field, { target: { value: "javascript:bad()" } }); fireEvent.blur(field);
  expect(screen.getByRole("alert")).toBeInTheDocument(); expect(change).not.toHaveBeenCalled();
  fireEvent.change(field, { target: { value: "https://example.com" } }); fireEvent.blur(field);
  expect(JSON.parse(change.mock.lastCall?.[1]["link:0"]).href).toBe("https://example.com");
});
it.each([["Email", "mailto:staff@example.com", "staff@example.com"], ["Phone", "tel:+15555555555", "+15555555555"]])("provides the %s prefix", (helper, href, input) => {
  const { change } = setup("button"), field = screen.getByRole("textbox", { name: "Link Address" });
  fireEvent.focus(field); fireEvent.click(screen.getByRole("button", { name: helper }));
  fireEvent.change(field, { target: { value: input } });
  expect(field).toHaveValue(input); fireEvent.blur(field);
  expect(JSON.parse(change.mock.lastCall?.[1]["link:0"]).href).toBe(href);
});
it.each(["Web Address", "Choose a Page", "Email", "Phone", "Lighting"])("%s never submits or navigates the Manager", label => {
  const submit = vi.fn(), { change } = setup("a", submit);
  const field = screen.getByRole("textbox", { name: "Link Address" });
  fireEvent.focus(field);
  if (label === "Lighting") fireEvent.click(screen.getByRole("button", { name: "Choose a Page" }));
  const option = screen.getByRole("button", { name: label });
  expect(fireEvent.mouseDown(option)).toBe(false);
  expect(option).toHaveAttribute("type", "button");
  const location = window.location.href;
  fireEvent.click(option);
  expect(submit).not.toHaveBeenCalled(); expect(window.location.href).toBe(location);
  if (label === "Lighting") expect(JSON.parse(change.mock.lastCall?.[1]["link:0"])).toEqual({ href: "/lighting" });
  else expect(change).not.toHaveBeenCalled();
});
it.each(["pointerDown", "focus", "click"] as const)("opens on the first %s and reopens while already focused", action => {
  setup(); const field = screen.getByRole("textbox", { name: "Link Address" });
  fireEvent[action](field); expect(field).toHaveAttribute("aria-expanded", "true");
  fireEvent.keyDown(field, { key: "Escape" }); expect(field).toHaveAttribute("aria-expanded", "false");
  fireEvent[action](field); expect(screen.getByLabelText("Link Address Options")).toBeInTheDocument();
});
it("page search Enter never submits", () => {
  const submit = vi.fn(); setup("a", submit);
  fireEvent.focus(screen.getByRole("textbox", { name: "Link Address" }));
  fireEvent.click(screen.getByRole("button", { name: "Choose a Page" }));
  expect(fireEvent.keyDown(screen.getByRole("textbox", { name: "Find a Page" }), { key: "Enter" })).toBe(false);
  expect(submit).not.toHaveBeenCalled();
});
it("restores the true shared original, refreshes the input and stores only override removal", () => {
  const selection = remoteSelection({ key: "0", scope: "object:about", kind: "text", tag: "a", attrs: { href: "/contact" }, originalHref: "/locations" });
  const change = vi.fn();
  function Panel() {
    const [edits, setEdits] = useState<InlineEdits>({ "link:0": '{"href":"/contact"}', "style:0": '{}' });
    return <InlineDestinationPanel selection={selection} pages={[]} editsFor={() => edits} onChange={(scope, next) => { change(scope, next); setEdits(next); }} />;
  }
  render(<Panel />);
  const field = screen.getByRole("textbox", { name: "Link Address" });
  expect(field).toHaveValue("/contact");
  fireEvent.click(screen.getByRole("button", { name: "Restore Original Link" }));
  expect(field).toHaveValue("/locations");
  expect(change).toHaveBeenLastCalledWith("object:about", { "style:0": '{}' });
  fireEvent.blur(field);
  expect(change).toHaveBeenCalledTimes(1);
});
it("does not offer a false restore when a remote frame reports only the edited address", () => {
  const selection = remoteSelection({ key: "0", scope: "object:about", kind: "text", tag: "a", attrs: { href: "/contact" } });
  const change = vi.fn();
  render(<InlineDestinationPanel selection={selection} pages={[]} editsFor={() => ({ "link:0": '{"href":"/contact"}' })} onChange={change} />);
  fireEvent.click(screen.getByRole("button", { name: "Restore Original Link" }));
  expect(change).not.toHaveBeenCalled();
});