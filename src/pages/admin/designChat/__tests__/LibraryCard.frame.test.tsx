import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Box } from "lucide-react";
import LibraryCard from "../LibraryCard";

const base = { labels: ["Room/Kitchen"], selected: true, FallbackIcon: Box, onPick: () => {} };

describe("LibraryCard thumbnail frame", () => {
  it("uses yellow selected tokens for the outline and pill while preserving pressed state and check icon", () => {
    const { getByRole, getByText, rerender } = render(<LibraryCard {...base} item={{ kind: "object", id: "selected", name: "Selected Object", type: "coded" }} />);
    const card = getByRole("button", { name: "Selected Object" });
    expect(card).toHaveAttribute("aria-pressed", "true");
    expect(card).toHaveClass("border-tag-selected", "ring-tag-selected");
    expect(getByText("Selected")).toHaveClass("bg-tag-selected", "text-tag-selected-foreground");
    expect(getByText("Selected").querySelector("svg")).not.toBeNull();
    rerender(<LibraryCard {...base} selected={false} added item={{ kind: "object", id: "selected", name: "Selected Object", type: "coded" }} />);
    expect(card).toHaveAttribute("aria-pressed", "false");
    expect(card).toHaveClass("border-primary", "ring-primary");
    expect(getByText("Added")).toHaveClass("bg-primary", "text-primary-foreground");
  });
  it("keeps a fixed 4:3 frame that a tall image cannot resize", () => {
    const { container } = render(<LibraryCard {...base} item={{ kind: "image", id: "1", name: "Tall", url: "/t.jpg", thumb: "/t.jpg" } as any} />);
    const frame = container.querySelector("[data-thumb-frame]")!;
    expect(frame.className).toContain("aspect-[4/3]");
    expect(frame.className).toContain("overflow-hidden");
    const fill = frame.querySelector("[data-thumb-fill]")!;
    expect(fill.className).toMatch(/absolute inset-0/);
    const img = fill.querySelector("img")!;
    Object.defineProperty(img, "naturalWidth", { value: 100 });
    Object.defineProperty(img, "naturalHeight", { value: 1000 });
    expect(img.className).toMatch(/absolute inset-0/);
    expect(img.className).toContain("object-contain");
  });

  it("puts custom thumbnails inside the absolute fill layer", () => {
    const { container } = render(<LibraryCard {...base} item={{ kind: "object", id: "o", name: "Obj" } as any} thumbnail={<i data-x="" />} />);
    expect(container.querySelector("[data-thumb-fill] [data-x]")).not.toBeNull();
  });
});
