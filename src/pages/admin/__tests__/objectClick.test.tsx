import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { applySwap, copyName, objectClickAction, objectClickKind, otherPagesUsing, objectSwaps, parseObjectClick, siteWideLabel, unusedCopies } from "../objectClick";
import ObjectClickDialog from "../ObjectClickDialog";
import ConfirmDialog from "../ConfirmDialog";
import { fontMenu } from "../designChat/fontOptions";
import { objectSwapPayload } from "../framedPageProtocol";
import { uniquePageUsages } from "../objectUsages";

afterEach(cleanup);
const click = { objectId: "o1", componentKey: "AboutUs", name: "About Us", slot: "s1", siteWide: false };

describe("edit-object-click", () => {
  it("accepts the exact site header payload with a null object id", () => {
    const payload = { type: "edit-object-click", objectId: null, componentKey: "Header", name: "Header", slot: "site-header", siteWide: true };
    expect(parseObjectClick(payload)).toEqual({ objectId: null, componentKey: "Header", name: "Header", slot: "site-header", siteWide: true });
    expect(parseObjectClick({ ...payload, componentKey: "Footer" })?.objectId).toBeNull();
    expect(parseObjectClick({ ...payload, componentKey: "Categories" })).toBeNull();
    expect(parseObjectClick({ ...payload, siteWide: false })).toBeNull();
  });
  it("sends the copied object's full saved data with the swap without changing stored edits", () => {
    const edits = { "objectSwap:code:home-categories": "copy" };
    const row = { status: "Ready", name: "Categories (Homepage)", component_key: "Categories", content: { sections: [] }, inline_edits: { "0": "Saved wording" } };
    expect(objectSwapPayload(objectSwaps(edits), { copy: row })).toEqual({ "code:home-categories": { id: "copy", ...row } });
    expect(edits).toEqual({ "objectSwap:code:home-categories": "copy" });
  });
  it("shows the Homepage once by name for both home paths", () => {
    expect(uniquePageUsages([{ path: "/home", name: "/home" }, { path: "/", name: "Homepage" }, { path: "/about", name: "About" }]).map(u => u.name)).toEqual(["Homepage", "About"]);
  });
  it("validates the frame message", () => {
    expect(parseObjectClick({ type: "edit-object-click", objectId: "o1", slot: "s1", name: "About Us", componentKey: "AboutUs" })).toEqual(click);
    expect(parseObjectClick({ objectId: "", slot: "s1" })).toBeNull();
    expect(parseObjectClick({ objectId: "o1" })).toBeNull();
    expect(parseObjectClick({ objectId: "o1", slot: "s", componentKey: 4 })).toBeNull();
    expect(parseObjectClick({ objectId: "o1", slot: "s", siteWide: true, componentKey: "Header" })?.siteWide).toBe(true);
  });
  it("chooses site-wide, page-only copy or shared", () => {
    expect(objectClickKind({ ...click, componentKey: "Header" }, {})).toBe("site");
    expect(objectClickKind({ ...click, componentKey: "Footer" }, {})).toBe("site");
    expect(siteWideLabel("Footer")).toBe("Footer");
    expect(objectClickKind({ ...click, siteWide: true }, {})).toBe("site");
    expect(objectClickKind(click, { "objectSwap:x": "o1" })).toBe("copy");
    expect(objectClickKind(click, {})).toBe("shared");
  });
  it("names copies within the allowed shape", () => {
    expect(copyName("About Us", "Homepage")).toBe("About Us (Homepage)");
    expect(copyName("Hero & Co.", "Team / Staff")).toBe("Hero Co (Team Staff)");
    expect(copyName("x".repeat(100), "Page").length).toBe(80);
  });
  it("records a swap in the edits and on the page-content block; discard/undo leaves the copy unused", () => {
    const blocks = [{ id: "s1", type: "object", objectId: "o1" }, { id: "b", type: "text" }];
    const next = applySwap(blocks, {}, "s1", "copy1");
    expect(next.edits).toEqual({ "objectSwap:s1": "copy1" });
    expect(next.blocks[0].objectId).toBe("copy1");
    expect(objectSwaps(next.edits)).toEqual({ s1: "copy1" });
    expect(unusedCopies(["copy1"], { blocks: next.blocks, inlineEdits: next.edits })).toEqual([]);
    // Discard / undo returns to the opening state: the copy is no longer used and gets removed.
    expect(unusedCopies(["copy1"], { blocks, inlineEdits: {} })).toEqual(["copy1"]);
    const coded = applySwap(blocks, {}, "hero-slot", "copy2");
    expect(coded.changedBlocks).toBe(false);
    expect(coded.edits).toEqual({ "objectSwap:hero-slot": "copy2" });
  });
});

describe("object dialogs", () => {
  const props = { pageName: "Homepage", busy: false, onOpen: vi.fn(), onCopy: vi.fn(), onCancel: vi.fn() };
  const next = () => fireEvent.click(screen.getByRole("button", { name: "Open in Object Editor" }));
  it("first says it's a shared object edited separately, with Open in Object Editor and Cancel", () => {
    render(<ObjectClickDialog {...props} ask={{ ...click, kind: "shared", usedOn: ["Homepage", "About"] }} />);
    expect(screen.getByRole("heading", { name: "Shared Object" })).toBeInTheDocument();
    expect(screen.getByText("About Us is an object, so it's edited separately in the object editor, not here on the page.")).toBeInTheDocument();
    expect(screen.getAllByRole("button").filter(b => b.textContent).map(b => b.textContent)).toEqual(["Open in Object Editor", "Cancel", "Close"]);
    expect(props.onOpen).not.toHaveBeenCalled();
  });
  it("then warns which other pages change, and still lets the person open it or make a copy", () => {
    props.onOpen.mockClear(); props.onCopy.mockClear();
    render(<ObjectClickDialog {...props} ask={{ ...click, kind: "shared", usedOn: ["Homepage", "About"] }} />);
    next();
    expect(screen.getByRole("heading", { name: "Before You Open About Us" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("About Us is also used on About. Changes you make in the object editor will show up on those pages too. To change it only on Homepage, make a copy instead.");
    expect(screen.getAllByRole("button").filter(b => b.textContent).map(b => b.textContent)).toEqual(["Open and Edit Everywhere", "Make a Copy for This Page", "Back", "Cancel", "Close"]);
    fireEvent.click(screen.getByRole("button", { name: "Make a Copy for This Page" }));
    expect(props.onCopy).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Open and Edit Everywhere" }));
    expect(props.onOpen).toHaveBeenCalledOnce();
  });
  it("Back returns to the first step", () => {
    render(<ObjectClickDialog {...props} ask={{ ...click, kind: "shared", usedOn: ["Homepage", "About"] }} />);
    next();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("heading", { name: "Shared Object" })).toBeInTheDocument();
  });
  it.each([
    ["used only on this page", { kind: "shared" as const, usedOn: ["Homepage"] }],
    ["a page-only copy", { kind: "copy" as const, usedOn: ["Homepage"] }],
  ])("%s also asks, then says changes only affect this page, with no copy option", (_label, extra) => {
    render(<ObjectClickDialog {...props} ask={{ ...click, ...extra }} />);
    expect(screen.getByRole("heading", { name: "Object" })).toBeInTheDocument();
    next();
    expect(screen.getByRole("alert")).toHaveTextContent("About Us is only used on Homepage, so changes you make in the object editor only affect this page.");
    expect(screen.getByRole("button", { name: "Open Object Editor" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Make a Copy for This Page" })).toBeNull();
  });
  it("when usage can't be told, it warns it may be used elsewhere and offers a copy", () => {
    render(<ObjectClickDialog {...props} ask={{ ...click, kind: "shared", usedOn: null }} />);
    next();
    expect(screen.getByRole("alert")).toHaveTextContent("may also be used on other pages");
    expect(screen.getByRole("button", { name: "Make a Copy for This Page" })).toBeInTheDocument();
  });
  it("keeps the old open-or-ask rule available for other callers", () => {
    expect(objectClickAction("shared", ["Homepage"], "Homepage")).toBe("open");
    expect(objectClickAction("copy", ["Homepage"], "Homepage")).toBe("open");
    expect(objectClickAction("shared", ["Homepage", "About"], "Homepage")).toBe("ask");
    expect(objectClickAction("site", [], "Homepage")).toBe("ask");
    expect(otherPagesUsing(["Homepage", "About", "About"], "Homepage")).toEqual(["About"]);
  });
  it("site header warns about the whole site", () => {
    render(<ObjectClickDialog {...props} ask={{ ...click, componentKey: "Header", kind: "site", usedOn: [] }} />);
    expect(screen.getByRole("heading", { name: "Site Header" })).toBeInTheDocument();
    expect(screen.getByText(/shared by every page/)).toBeInTheDocument();
    next();
    expect(screen.getByRole("heading", { name: "Before You Open the Site Header" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("change the header on every page of the site");
    expect(screen.queryByRole("button", { name: "Make a Copy for This Page" })).toBeNull();
  });
});

describe("save flow", () => {
  it("Save Your Changes? lists Save Changes, Discard Changes, Return to Edit left to right", () => {
    render(<ConfirmDialog open onOpenChange={() => {}} title="Save Your Changes?" description="" destructive={false} primaryFirst
      confirmLabel="Save Changes" secondaryLabel="Discard Changes" cancelLabel="Return to Edit" onConfirm={() => {}} onSecondary={() => {}} />);
    expect(screen.getAllByRole("button").map(b => b.textContent)).toEqual(["Save Changes", "Discard Changes", "Return to Edit"]);
  });
});

describe("font menu", () => {
  it("lists the inherited font once without (default)", () => {
    const menu = fontMenu("Cormorant Garamond");
    expect(menu.inheritedLabel).toBe("Cormorant Garamond");
    expect(menu.others.map(([n]) => n)).toEqual(["Figtree", "Georgia", "Monospace"]);
    expect(fontMenu("Arial").others).toHaveLength(4);
  });
});
