import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import LabelsCell from "../LabelsCell";
import LabelPicker from "../LabelPicker";
vi.mock("../useAllLabels", () => ({
  useLabelsForScope: () => ({ data: [{ id: "editorial", path: "editorial", name: "Editorial", color_index: 2 }] }),
  useInvalidateLabels: () => vi.fn(),
}));
vi.mock("../useLabelUsageCounts", () => ({ useLabelUsageCounts: () => ({ data: { editorial: 7 } }) }));
afterEach(cleanup);
it.each(["images", "videos", "objects", "static", "landing"] as const)("edits only this %s item's labels through the shared picker", scope => {
  const change = vi.fn();
  render(<LabelsCell scope={scope} itemName="Living Room" value={[]} onChange={change} />);
  fireEvent.click(screen.getByRole("button", { name: "Edit Labels for Living Room" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Search Labels" }), { target: { value: "Editorial" } });
  fireEvent.click(screen.getByRole("checkbox", { name: "editorial" }));
  expect(change).toHaveBeenCalledWith(["editorial"]);
});
it("removing an assigned image label retains the original item-only callback", () => {
  const change = vi.fn();
  render(<LabelPicker scope="images" value={["editorial"]} onChange={change} />);
  fireEvent.click(screen.getByRole("button", { name: "Remove editorial" }));
  expect(change).toHaveBeenCalledWith([]);
});