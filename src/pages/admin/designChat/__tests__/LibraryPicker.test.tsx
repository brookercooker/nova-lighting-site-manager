import { useState } from "react";
import { cleanup, createEvent, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Box, Image as ImageIcon } from "lucide-react";
import LibraryPicker from "../LibraryPicker";
import type { ChatReference } from "../references";
import LibraryCard from "../LibraryCard";
import { PALETTE, colorFor } from "../../labelColors";

const many = Array.from({ length: 70 }, (_, n) => ({ id: `i${n}`, name: `photo-${String(n).padStart(2, "0")}.jpg`, url: `https://x/${n}.webp`, alt: `photo ${n}`, labels: n === 7 ? ["Rooms/Lobby"] : n === 8 ? ["Z/a", "Z/b", "Z/c", "Z/d", "Z/e"] : n === 2 ? ["Area/Kitchen"] : [], createdAt: n === 5 ? "2026-01-03T00:00:00Z" : n === 6 ? "2025-01-01T00:00:00Z" : undefined }));
const thumbs = vi.hoisted(() => ({ data: {} as Record<string, Record<string, string>>, calls: vi.fn() }));
vi.mock("../../useAdminData", () => ({ useImageThumbnails: (bucket: string, paths: string[], width: number) => {
  thumbs.calls(bucket, paths, width);
  return { data: thumbs.data[bucket] ?? {} };
} }));
vi.mock("../../ImagePickerDialog", async () => {
  const real = await vi.importActual<any>("../../ImagePickerDialog");
  return { ...real, loadLibraryImages: async () => many };
});
vi.mock("../../ObjectThumbnail", () => ({ default: () => <div /> }));
vi.mock("../../VideoPickerDialog", () => ({ loadLibraryVideos: async () => [], videoMatches: () => true }));
vi.mock("../../ObjectPickerDialog", async () => {
  const real = await vi.importActual<any>("../../ObjectPickerDialog");
  return { ...real, loadLibraryObjects: async () => [
    { id: "o1", name: "Hero", component_key: "Hero", status: "Draft", labels: ["Homepage/Hero", "Marketing"] },
    { id: "o2", name: "Flyer", component_key: null, status: "Ready", labels: ["Marketing"] },
  ] };
});
const labelData = vi.hoisted(() => ({ rows: [{ path: "Rooms/Lobby", color_index: 7 }] }));
vi.mock("../../useAllLabels", () => ({ useLabelsForScope: () => ({ data: labelData.rows, refetch: vi.fn() }) }));
beforeEach(() => {
  thumbs.data = {}; thumbs.calls.mockClear();
  labelData.rows = [{ path: "Rooms/Lobby", color_index: 7 }];
  HTMLElement.prototype.scrollIntoView = vi.fn();
  many.forEach((i, n) => Object.assign(i, { visibility: n % 2 === 0 ? "gated" : "public", webPath: `${n}.webp`, webUrl: `/__l5e/assets-v1/id/${n}.jpg` }));
  (globalThis as any).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
});
afterEach(cleanup);

const setup = (kind: "images" | "objects" = "images", addedRefs: ChatReference[] = []) => {
  const picked = vi.fn(), onOpenFull = vi.fn();
  function Picker() {
    const [refs, setRefs] = useState(addedRefs);
    return <LibraryPicker addedRefs={refs} kind={kind} label={label} Icon={kind === "images" ? ImageIcon : Box} active={false} showLabel className="" onPick={ref => { picked(ref); setRefs(current => current.some(r => r.id === ref.id) ? current.filter(r => r.id !== ref.id) : [...current, ref]); }} onOpenFull={onOpenFull} onDeselectAll={(k) => setRefs(current => current.filter(r => r.kind !== k))} />;
  }
  const label = kind === "images" ? "Images" : "Objects";
  const view = render(<Picker />);
  fireEvent.click(screen.getByRole("button", { name: label }));
  return { onPick: picked, onOpenFull, ...view };
};
const cards = () => within(screen.getByRole("dialog")).getAllByRole("button").filter((b) => /^(photo-|Hero|Flyer)/.test(b.getAttribute("title") ?? ""));

describe("library picker", () => {
  it("keeps native label-list wheel and touch scrolling out of the dialog scroll lock", async () => {
    setup("objects");
    await screen.findByTitle("Flyer");
    fireEvent.click(screen.getByRole("button", { name: "More Labels" }));
    const list = screen.getByRole("group", { name: "Label Results" });
    const scrollLock = vi.fn();
    document.addEventListener("wheel", scrollLock);
    document.addEventListener("touchmove", scrollLock);
    try {
      const wheel = createEvent.wheel(list, { deltaY: 100, bubbles: true, cancelable: true });
      const touch = createEvent.touchMove(list, { bubbles: true, cancelable: true });
      expect(fireEvent(list, wheel)).toBe(true);
      expect(fireEvent(list, touch)).toBe(true);
      expect(wheel.defaultPrevented).toBe(false);
      expect(touch.defaultPrevented).toBe(false);
      expect(scrollLock).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener("wheel", scrollLock);
      document.removeEventListener("touchmove", scrollLock);
    }
  });
  it("toggles multiple object chips and Any/All without losing selected objects", async () => {
    labelData.rows = [{ path: "Homepage", color_index: 7 }, { path: "Marketing", color_index: 7 }];
    const { onPick } = setup("objects");
    await screen.findByTitle("Flyer");
    fireEvent.click(screen.getByTitle("Flyer"));
    fireEvent.click(screen.getByRole("button", { name: "Homepage" }));
    expect(screen.queryByRole("button", { name: "Any Label" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Marketing" }));
    expect(screen.getByRole("button", { name: "Homepage" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Marketing" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Any Label" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("2 of 2 shown · matching any of 2 labels")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "All Labels" }));
    expect(screen.getByText("1 of 1 shown · matching all of 2 labels")).toBeInTheDocument();
    expect(screen.queryByTitle("Flyer")).toBeNull();
    expect(screen.getByText("1 selected")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Homepage" }));
    expect(screen.queryByRole("button", { name: "All Labels" })).toBeNull();
    expect(screen.getByTitle("Flyer")).toHaveAttribute("aria-pressed", "true");
    fireEvent.change(screen.getByLabelText("Search Objects"), { target: { value: "Hero" } });
    fireEvent.click(screen.getByRole("button", { name: "Clear Filters" }));
    expect(screen.getByLabelText("Search Objects")).toHaveValue("");
    fireEvent.click(screen.getByRole("button", { name: "Homepage" }));
    fireEvent.click(screen.getByRole("button", { name: "More Labels" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Marketing" }));
    fireEvent.click(within(screen.getAllByRole("dialog").at(-1) as HTMLElement).getByRole("button", { name: "Done" }));
    expect(screen.getByRole("button", { name: "Homepage" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Any Label" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "More Labels" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Marketing" }));
    fireEvent.click(within(screen.getAllByRole("dialog").at(-1) as HTMLElement).getByRole("button", { name: "Done" }));
    expect(screen.getByRole("button", { name: "Marketing" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByRole("button", { name: "Any Label" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^All$/ }));
    expect(screen.getByTitle("Flyer")).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onPick).toHaveBeenCalledTimes(1);
  });
  it("keeps ranked object chips in place while toggling two labels", async () => {
    labelData.rows = [{ path: "Homepage", color_index: 7 }, { path: "Marketing", color_index: 7 }];
    setup("objects");
    await screen.findByTitle("Flyer");
    const order = () => Array.from(screen.getByRole("group", { name: "Filter by Label" }).querySelectorAll("[data-label-chips] button[title]")).map(chip => chip.getAttribute("title"));
    expect(order()).toEqual(["Marketing", "Homepage", "Homepage/Hero"]);
    const before = order();
    fireEvent.click(screen.getByRole("button", { name: "Marketing" }));
    expect(order()).toEqual(before);
    fireEvent.click(screen.getByRole("button", { name: "Homepage" }));
    expect(order()).toEqual(before);
    fireEvent.click(screen.getByRole("button", { name: "Marketing" }));
    expect(order()).toEqual(before);
  });
  it("appends rare object labels in selection order without replacing popular chips", async () => {
    labelData.rows = Array.from({ length: 10 }, (_, n) => ({ path: `Rare ${n}`, color_index: 7 }));
    setup("objects");
    await screen.findByTitle("Flyer");
    const order = () => Array.from(screen.getByRole("group", { name: "Filter by Label" }).querySelectorAll("[data-label-chips] button[title]")).map(chip => chip.getAttribute("title"));
    const before = order();
    expect(before).toHaveLength(8);
    for (const path of ["Rare 9", "Rare 8"]) {
      fireEvent.click(screen.getByRole("button", { name: "More Labels" }));
      fireEvent.click(screen.getByRole("checkbox", { name: path }));
      fireEvent.click(within(screen.getAllByRole("dialog").at(-1) as HTMLElement).getByRole("button", { name: "Done" }));
    }
    expect(order()).toEqual([...before, "Rare 9", "Rare 8"]);
    fireEvent.click(screen.getByRole("button", { name: "Rare 9" }));
    expect(order()).toEqual([...before, "Rare 8"]);
  });
  it("toggles attached images immediately and keeps the card synchronized", async () => {
    const ref: ChatReference = { kind: "image", id: "i3", name: "photo-03.jpg", url: "url", labels: [] };
    const { onPick } = setup("images", [ref]);
    await screen.findByText("60 of 70 shown");
    const card = screen.getByTitle("photo-03.jpg");
    expect(card).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(card);
    expect(card).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(card);
    expect(card).toHaveAttribute("aria-pressed", "true");
    expect(onPick).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onPick).toHaveBeenCalledTimes(2);
  });
  it.each(["video", "object"] as const)("marks already-attached %s separately from selection", (kind) => {
    const item: ChatReference = kind === "video" ? { kind, id: "v", name: "Video", url: "video", labels: [] } : { kind, id: "o", name: "Object", type: "built in code" };
    render(<LibraryCard item={item} labels={[]} added selected={false} FallbackIcon={Box} onPick={vi.fn()} />);
    expect(screen.getByRole("button", { name: `${item.name} — Already added` })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("Added")).toBeInTheDocument();
    expect(screen.queryByText("Selected")).toBeNull();
  });
  it("filters through a searchable folder menu with over 200 labels and keeps the selection as a chip", async () => {
    labelData.rows = Array.from({ length: 205 }, (_, n) => ({ path: `Folder/Label ${n}`, color_index: 7 }));
    labelData.rows.push({ path: "Rooms/Lobby", color_index: 7 });
    setup(); await screen.findByText("60 of 70 shown");
    const group = screen.getByRole("group", { name: "Filter by Label" });
    expect(group.querySelectorAll("[data-label-chips] button[title]")).toHaveLength(8);
    fireEvent.click(screen.getByRole("button", { name: "More Labels" }));
    expect(within(screen.getByRole("group", { name: "Label Results" })).getAllByRole("checkbox")).toHaveLength(212);
    expect(screen.getByRole("checkbox", { name: "Rooms/Lobby" })).toHaveTextContent("1");
    expect(screen.getByRole("checkbox", { name: "Folder/Label 204" })).toHaveTextContent("0");
    fireEvent.change(screen.getByRole("textbox", { name: "Search Labels" }), { target: { value: "Lobby" } });
    await waitFor(() => expect(within(screen.getByRole("group", { name: "Label Results" })).getAllByRole("checkbox")).toHaveLength(1));
    fireEvent.click(screen.getByRole("checkbox", { name: "Rooms/Lobby" }));
    fireEvent.click(within(screen.getAllByRole("dialog").at(-1) as HTMLElement).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(cards()).toHaveLength(1));
    expect(within(group).getByRole("button", { name: "Lobby" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Clear Label" }));
    await screen.findByText("60 of 70 shown");
  });
  it("keeps a rare selected label visible among the eight chips", async () => {
    labelData.rows = Array.from({ length: 205 }, (_, n) => ({ path: `Folder/Label ${n}`, color_index: 7 }));
    setup(); await screen.findByText("60 of 70 shown");
    fireEvent.click(screen.getByRole("button", { name: "More Labels" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Search Labels" }), { target: { value: "Label 204" } });
    await waitFor(() => expect(within(screen.getByRole("group", { name: "Label Results" })).getAllByRole("checkbox")).toHaveLength(1));
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Search Labels" }), { key: "ArrowDown" });
    fireEvent.keyDown(screen.getByRole("checkbox", { name: "Folder/Label 204" }), { key: "Enter" });
    fireEvent.click(within(screen.getAllByRole("dialog").at(-1) as HTMLElement).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Label 204" })).toHaveAttribute("aria-pressed", "true"));
    expect(screen.getByRole("group", { name: "Filter by Label" }).querySelectorAll("[data-label-chips] button[title]")).toHaveLength(8);
    expect(screen.getByText("No images match")).toBeInTheDocument();
  });
  it("centers whole image thumbnails for both the thumbnail and web fallback", async () => {
    thumbs.data = { "images-web-gated": { "0.webp": "https://signed/0" } };
    setup(); await screen.findByText("60 of 70 shown");
    const card = screen.getByTitle("photo-00.jpg");
    const img = card.querySelector("img");
    expect(img).toHaveClass("object-contain", "object-center");
    if (!img) throw new Error("Expected thumbnail");
    fireEvent.error(img);
    expect(card.querySelector("img")).toHaveClass("object-contain", "object-center");
  });
  it.each(["video", "object"] as const)("keeps %s thumbnails cropped as before", (kind) => {
    const item = kind === "video"
      ? { kind, id: "v", name: "Video", url: "video", thumb: "poster", labels: [] }
      : { kind, id: "o", name: "Object", type: "built in code", thumb: "object-thumb" };
    const { container } = render(<LibraryCard item={item} labels={[]} selected={false} FallbackIcon={Box} onPick={vi.fn()} />);
    expect(container.querySelector("img")).toHaveClass("object-cover");
    expect(container.querySelector("img")).not.toHaveClass("object-contain");
  });
  it("uses stored Lovable asset URLs regardless of visibility while thumbnails are pending", async () => {
    setup(); await screen.findByText("60 of 70 shown");
    expect(screen.getByTitle("photo-00.jpg").querySelector("img")).toHaveAttribute("src", "/__l5e/assets-v1/id/0.jpg");
    expect(screen.getByTitle("photo-01.jpg").querySelector("img")).toHaveAttribute("src", "/__l5e/assets-v1/id/1.jpg");
  });
  it("does not use a private staging URL while signing is pending", async () => {
    Object.assign(many[0], { webUrl: "https://x/images-web-gated/0.webp" });
    setup(); await screen.findByText("60 of 70 shown");
    expect(screen.getByTitle("photo-00.jpg").querySelector("img")).toBeNull();
  });
  it("uses signed gated and public transformed thumbnails without changing the picked URL", async () => {
    thumbs.data = { "images-web-gated": { "0.webp": "https://signed/0" }, "images-web": { "1.webp": "https://public/thumb/1" } };
    const { onPick } = setup(); await screen.findByText("60 of 70 shown");
    expect(screen.getByTitle("photo-00.jpg").querySelector("img")).toHaveAttribute("src", "https://signed/0");
    expect(screen.getByTitle("photo-01.jpg").querySelector("img")).toHaveAttribute("src", "https://public/thumb/1");
    fireEvent.click(screen.getByTitle("photo-00.jpg"));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: "i0", url: "https://x/0.webp" }));
  });
  it("requests thumbnail batches only for shown images and updates them when filtering", async () => {
    setup(); await screen.findByText("60 of 70 shown");
    expect(thumbs.calls).toHaveBeenCalledWith("images-web-gated", Array.from({ length: 30 }, (_, n) => `${n * 2}.webp`), 320);
    expect(thumbs.calls.mock.calls.every(([, paths]) => !paths.includes("60.webp"))).toBe(true);
    fireEvent.change(screen.getByLabelText("Search Images"), { target: { value: "photo-60" } });
    await waitFor(() => expect(thumbs.calls).toHaveBeenCalledWith("images-web-gated", ["60.webp"], 320));
  });
  it("a failed final thumbnail remains selectable with its original reference", async () => {
    thumbs.data = { "images-web-gated": { "0.webp": "https://signed/0" } };
    const { onPick } = setup(); await screen.findByText("60 of 70 shown");
    const card = screen.getByTitle("photo-00.jpg");
    const img = card.querySelector("img");
    if (!img) throw new Error("Expected signed thumbnail");
    fireEvent.error(img);
    const fallback = card.querySelector("img");
    expect(fallback).toHaveAttribute("src", "/__l5e/assets-v1/id/0.jpg");
    if (!fallback) throw new Error("Expected web URL fallback");
    fireEvent.error(fallback);
    expect(card.querySelector("img")).toBeNull();
    fireEvent.click(card);
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: "i0", url: "https://x/0.webp" }));
  });
  it("keeps the picture after a storage thumbnail fails but the asset URL loads", async () => {
    thumbs.data = { "images-web": { "1.webp": "https://public/thumb/1" } };
    setup(); await screen.findByText("60 of 70 shown");
    const card = screen.getByTitle("photo-01.jpg");
    const img = card.querySelector("img");
    if (!img) throw new Error("Expected public thumbnail");
    fireEvent.error(img);
    expect(card.querySelector("img")).toHaveAttribute("src", "/__l5e/assets-v1/id/1.jpg");
    fireEvent.load(card.querySelector("img") as HTMLImageElement);
    expect(card.querySelector("img")).toHaveAttribute("src", "/__l5e/assets-v1/id/1.jpg");
  });
  it("opens a side panel with search that narrows the grid", async () => {
    setup();
    expect(await screen.findByRole("heading", { name: "Pick an Image" })).toBeInTheDocument();
    expect(await screen.findByText("60 of 70 shown")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Search Images"), { target: { value: "lobby" } });
    await waitFor(() => expect(cards()).toHaveLength(1));
    fireEvent.change(screen.getByLabelText("Search Images"), { target: { value: "zzz" } });
    expect(await screen.findByText("No images match")).toBeInTheDocument();
    expect(screen.getByText("Try fewer words or clear the filters")).toBeInTheDocument();
  });
  it("a label chip filters and clicking it again clears", async () => {
    setup();
    await screen.findByText("60 of 70 shown");
    const chip = screen.getByRole("button", { name: "Lobby" });
    expect(chip).toHaveAttribute("title", "Rooms/Lobby");
    fireEvent.click(chip);
    await waitFor(() => expect(cards()).toHaveLength(1));
    fireEvent.click(chip);
    expect(await screen.findByText("60 of 70 shown")).toBeInTheDocument();
  });
  it("Show More reveals 60 more", async () => {
    setup();
    await screen.findByText("60 of 70 shown");
    fireEvent.click(screen.getByRole("button", { name: "Show More" }));
    expect(await screen.findByText("70 of 70 shown")).toBeInTheDocument();
    expect(cards()).toHaveLength(70);
  });
  it("select then Done adds items in selection order and closes", async () => {
    const { onPick } = setup();
    await screen.findByText("60 of 70 shown");
    fireEvent.click(screen.getByTitle("photo-04.jpg"));
    fireEvent.click(screen.getByTitle("photo-03.jpg"));
    expect(onPick).toHaveBeenCalledTimes(2);
    expect(screen.getByTitle("photo-04.jpg")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("2 selected")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onPick.mock.calls.map((c) => c[0].id)).toEqual(["i4", "i3"]);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
  it("clicking a selected card deselects it", async () => {
    setup();
    await screen.findByText("60 of 70 shown");
    fireEvent.click(screen.getByTitle("photo-03.jpg"));
    fireEvent.click(screen.getByTitle("photo-03.jpg"));
    expect(screen.getByTitle("photo-03.jpg")).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("Nothing selected yet")).toBeInTheDocument();
  });
  it("Done closes with no selection", async () => {
    setup();
    await screen.findByText("60 of 70 shown");
    expect(screen.getByRole("button", { name: "Done" })).toBeEnabled();
  });
  it("Done and Escape dismiss without changing picked references", async () => {
    const { onPick } = setup();
    await screen.findByText("60 of 70 shown");
    fireEvent.click(screen.getByTitle("photo-03.jpg"));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Images" }));
    await screen.findByText("60 of 70 shown");
    expect(screen.getByText("1 selected")).toBeInTheDocument();
    fireEvent.click(screen.getByTitle("photo-03.jpg"));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(onPick).toHaveBeenCalledTimes(2);
  });
  it("Enter in the search box finishes only with a selection", async () => {
    const { onPick } = setup();
    await screen.findByText("60 of 70 shown");
    const box = screen.getByLabelText("Search Images");
    fireEvent.keyDown(box, { key: "Enter" });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByTitle("photo-03.jpg"));
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onPick).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
  it("selection survives a search change", async () => {
    const { onPick } = setup();
    await screen.findByText("60 of 70 shown");
    fireEvent.click(screen.getByTitle("photo-03.jpg"));
    fireEvent.change(screen.getByLabelText("Search Images"), { target: { value: "lobby" } });
    await waitFor(() => expect(cards()).toHaveLength(1));
    expect(screen.getByText("1 selected")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: "i3" }));
  });
  it("has a link to the full page that closes the popup", async () => {
    const { onOpenFull } = setup();
    fireEvent.click(await screen.findByRole("button", { name: /Manage Images/ }));
    expect(onOpenFull).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
  const titles = () => cards().map((c) => c.getAttribute("title"));
  it("makes legacy Draft and Ready objects equally selectable without status tags", async () => {
    const { onPick } = setup("objects");
    await screen.findByTitle("Hero");
    expect(screen.queryByText(/^(Draft|Ready)$/)).toBeNull();
    fireEvent.click(screen.getByTitle("Hero"));
    fireEvent.click(screen.getByTitle("Flyer"));
    expect(onPick.mock.calls.map(([ref]) => ref.id)).toEqual(["o1", "o2"]);
  });
  const sortTo = (v: string) => fireEvent.change(screen.getByLabelText("Sort"), { target: { value: v } });
  it("Enter on a card retains native keyboard activation for toggling", async () => {
    const { onPick } = setup();
    await screen.findByText("60 of 70 shown");
    const card = screen.getByTitle("photo-03.jpg");
    fireEvent.click(card); card.focus();
    expect(fireEvent.keyDown(card, { key: "Enter" })).toBe(true);
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
  it("Enter finishes even when focus is on the page body", async () => {
    const { onPick } = setup();
    await screen.findByText("60 of 70 shown");
    fireEvent.click(screen.getByTitle("photo-03.jpg"));
    fireEvent.keyDown(document.body, { key: "Enter" });
    expect(onPick).toHaveBeenCalledTimes(1);
  });
  it("Enter on a card with nothing selected is left to the card (selects it)", async () => {
    const { onPick } = setup();
    await screen.findByText("60 of 70 shown");
    const card = screen.getByTitle("photo-03.jpg");
    const ev = fireEvent.keyDown(card, { key: "Enter" });
    expect(ev).toBe(true); // not prevented, so the button's native activation runs
    expect(onPick).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
  it("Enter on Cancel, Done or Show More is not hijacked", async () => {
    const { onPick } = setup();
    await screen.findByText("60 of 70 shown");
    fireEvent.click(screen.getByTitle("photo-03.jpg"));
    for (const name of ["Done", "Show More"]) {
      expect(fireEvent.keyDown(screen.getByRole("button", { name }), { key: "Enter" })).toBe(true);
    }
    expect(onPick).toHaveBeenCalledTimes(1);
  });
  it("Enter does nothing with nothing selected", async () => {
    const { onPick } = setup();
    await screen.findByText("60 of 70 shown");
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Enter" });
    fireEvent.keyDown(document.body, { key: "Enter" });
    expect(onPick).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
  it("sorts by name Z–A", async () => {
    setup(); await screen.findByText("60 of 70 shown");
    sortTo("name-desc");
    expect(titles()[0]).toBe("photo-69.jpg");
  });
  it("sorts newest and oldest first with undated items last", async () => {
    setup(); await screen.findByText("60 of 70 shown");
    sortTo("newest");
    expect(titles().slice(0, 3)).toEqual(["photo-05.jpg", "photo-06.jpg", "photo-00.jpg"]);
    sortTo("oldest");
    expect(titles().slice(0, 3)).toEqual(["photo-06.jpg", "photo-05.jpg", "photo-00.jpg"]);
    expect(screen.getByText("60 of 70 shown")).toBeInTheDocument();
  });
  it("groups by first label with unlabelled items last", async () => {
    setup(); await screen.findByText("60 of 70 shown");
    sortTo("label");
    expect(titles().slice(0, 4)).toEqual(["photo-02.jpg", "photo-07.jpg", "photo-08.jpg", "photo-00.jpg"]);
  });
  it("sort resets on reopen", async () => {
    setup(); await screen.findByText("60 of 70 shown");
    sortTo("name-desc");
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Images" }));
    await screen.findByText("60 of 70 shown");
    expect(screen.getByLabelText("Sort")).toHaveValue("name");
  });
  it("selection survives a sort change", async () => {
    setup(); await screen.findByText("60 of 70 shown");
    fireEvent.click(screen.getByTitle("photo-03.jpg"));
    sortTo("label");
    expect(screen.getByText("1 selected")).toBeInTheDocument();
    expect(screen.getByTitle("photo-03.jpg")).toHaveAttribute("aria-pressed", "true");
  });
  const bgOf = (v: string) => { const d = document.createElement("div"); d.style.background = v; return d.style.background; };
  it("card pills use the registered colour, or the hash fallback when unregistered", async () => {
    setup(); await screen.findByText("60 of 70 shown");
    const lobby = within(screen.getByTitle("photo-07.jpg")).getByTitle("Rooms/Lobby");
    expect(lobby).toHaveTextContent("Lobby");
    expect(lobby.style.background).toBe(bgOf(PALETTE[7].bg));
    const kitchen = within(screen.getByTitle("photo-02.jpg")).getByTitle("Area/Kitchen");
    expect(kitchen.style.background).toBe(bgOf(colorFor("Area/Kitchen").bg));
  });
  it("more than 3 labels shows +N listing the rest", async () => {
    setup(); await screen.findByText("60 of 70 shown");
    const card = screen.getByTitle("photo-08.jpg");
    expect(card.querySelectorAll("[data-label-pill]")).toHaveLength(3);
    expect(within(card).getByText("+2")).toHaveAttribute("title", "Z/d, Z/e");
  });
  it("label filter chips carry the label colour", async () => {
    setup(); await screen.findByText("60 of 70 shown");
    const chip = screen.getByRole("button", { name: "Lobby" });
    expect(chip.style.background).toBe(bgOf(PALETTE[7].bg));
    fireEvent.click(chip);
    expect(chip.style.background).toBe(bgOf(PALETTE[7].swatch));
  });
  it("Deselect All removes only this picker's kind and is disabled when nothing is selected", async () => {
    const image: ChatReference = { kind: "image", id: "i3", name: "photo-03.jpg", url: "url", labels: [] };
    const object: ChatReference = { kind: "object", id: "o1", name: "Hero", type: "coded" };
    setup("images", [image, object]);
    await screen.findByText("60 of 70 shown");
    expect(screen.getByText("1 selected")).toBeInTheDocument();
    const button = screen.getByRole("button", { name: "Deselect All" });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(screen.getByText("Nothing selected yet")).toBeInTheDocument();
    expect(screen.getByTitle("photo-03.jpg")).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Deselect All" })).toBeDisabled();
  });
});
