import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Box } from "lucide-react";
import FilterBar from "../FilterBar";
import LibraryCard from "../designChat/LibraryCard";
import imagePicker from "../ImagePickerDialog.tsx?raw";
import videoPicker from "../VideoPickerDialog.tsx?raw";

const BLACK = ["bg-foreground", "text-background", "border-foreground"];
const noop = () => {};
describe("selected styles", () => {
  it("range chips use the black selected style; selected tags and library cards stay yellow", () => {
    const { rerender } = render(<FilterBar sort="new" onSortChange={noop} sortOptions={[{ v: "new", label: "Newest" }]} timeRange="day" onTimeRangeChange={noop} dateFrom="" dateTo="" onDateFromChange={noop} onDateToChange={noop} />);
    const day = screen.getByRole("button", { name: "Last 24h" });
    expect(day).toHaveClass(...BLACK);
    expect(day.className).not.toContain("tag-selected");
    rerender(<FilterBar sort="new" onSortChange={noop} sortOptions={[{ v: "new", label: "Newest" }]} timeRange="custom" onTimeRangeChange={noop} dateFrom="" dateTo="" onDateFromChange={noop} onDateToChange={noop} />);
    expect(screen.getByRole("button", { name: "Custom" })).toHaveClass(...BLACK);
    // Picker tag rows: the "All" chip is black, an individual selected tag is yellow.
    for (const src of [imagePicker, videoPicker]) {
      expect(src).toMatch(/label === "" \? "bg-foreground text-background border-foreground"/);
      expect(src).toMatch(/label === l \? "bg-tag-selected text-tag-selected-foreground border-tag-selected"/);
    }
    render(<LibraryCard labels={[]} selected FallbackIcon={Box} onPick={noop} item={{ kind: "object", id: "o", name: "Obj", type: "coded" } as any} />);
    expect(screen.getByRole("button", { name: "Obj" })).toHaveClass("border-tag-selected");
    expect(screen.getByText("Selected")).toHaveClass("bg-tag-selected", "text-tag-selected-foreground");
  });
});
