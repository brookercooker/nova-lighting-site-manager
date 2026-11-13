import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import LibraryCardLabels from "../LibraryCardLabels";
import { addLibraryLabelFilter, cardLabelSummary, rankLibraryLabels, shortLabelName } from "../libraryLabels";
import { PALETTE } from "../labelColors";
import type { LabelRow } from "../useAllLabels";
vi.mock("../useAllLabels", () => ({ useLabelsForScope: () => ({ data: [] }) }));
afterEach(cleanup);
describe("library label rules", () => {
  it("caps names at twelve characters including the ellipsis", () => {
    expect(shortLabelName("abcdefghijklmnop")).toBe("abcdefghijk…");
    expect(shortLabelName("abcdefghijkl")).toBe("abcdefghijkl");
  });
  it("shows two unique labels and counts the remainder", () => {
    expect(cardLabelSummary(["a", "b", "c", "d", "a"], []).remaining).toBe(2);
    expect(cardLabelSummary(["a", "b", "c", "d"], []).visible.map(l => l.path)).toEqual(["a", "b"]);
    expect(cardLabelSummary([], [])).toEqual({ visible: [], remaining: 0 });
  });
  it("narrow grid cards retain one named label and an accurate remaining count", () => {
    expect(cardLabelSummary(["Residential", "Hospitality", "Retail"], [], 1)).toEqual({ visible: [{ path: "Residential", name: "Residential", colorIndex: undefined }], remaining: 2 });
    const apply = vi.fn();
    render(<LibraryCardLabels compact scope="objects" paths={["Residential", "Hospitality"]} onFilter={apply} />);
    fireEvent.click(screen.getByRole("button", { name: "Filter by Residential" }));
    expect(apply).toHaveBeenCalledWith("Residential");
    expect(screen.getByLabelText("1 more labels")).toHaveTextContent("+1");
  });
  it("click-to-filter uses the full stored path and preserves existing filters", () => {
    const apply = vi.fn();
    render(<LibraryCardLabels scope="objects" paths={["photos/abcdefghijklmnop"]} onFilter={apply} />);
    fireEvent.click(screen.getByRole("button", { name: "Filter by photos/abcdefghijklmnop" }));
    expect(apply).toHaveBeenCalledWith("photos/abcdefghijklmnop");
    expect(addLibraryLabelFilter(["footer"], "photos/abcdefghijklmnop")).toEqual(["footer", "photos/abcdefghijklmnop"]);
    expect(addLibraryLabelFilter(["footer"], "footer")).toEqual(["footer"]);
  });
  it("ranks the first three choices by usage without changing the source", () => {
    const rows = ["a", "b", "c", "d"].map(path => ({ path } as LabelRow));
    expect(rankLibraryLabels(rows, { d: 9, c: 4, b: 3 }).slice(0, 3).map(r => r.path)).toEqual(["d", "c", "b"]);
    expect(rows.map(r => r.path)).toEqual(["a", "b", "c", "d"]);
  });
  it.each(PALETTE)("$name text has at least 4.5:1 contrast against its tint", c => {
    const luminance = (hsl: string) => {
      const [h, s, l] = (hsl.match(/[\d.]+/g) ?? []).map(Number);
      const saturation = s / 100, lightness = l / 100;
      const a = saturation * Math.min(lightness, 1 - lightness);
      const rgb = [0, 8, 4].map(n => { const k = (n + h / 30) % 12; return lightness - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); });
      return rgb.map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
    };
    expect((luminance(c.bg) + .05) / (luminance(c.text) + .05)).toBeGreaterThanOrEqual(4.5);
  });
});