import { useState } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import UsedOnChoices from "../UsedOnChoices";
afterEach(cleanup);
const options = Array.from({ length: 12 }, (_, i) => ({ v: `page-${i}`, label: `Page ${i}` }));
it("limits initial pages to six and expands/searches/selects in place", () => {
  function Harness() { const [selected, setSelected] = useState("page-0"); return <UsedOnChoices options={options} selected={selected} onSelect={setSelected} />; }
  render(<Harness />);
  expect(within(screen.getByRole("group", { name: "Used On" })).getAllByRole("button")).toHaveLength(7);
  fireEvent.click(screen.getByRole("button", { name: "+ More" }));
  const search = screen.getByRole("textbox", { name: "Find Pages" });
  fireEvent.change(search, { target: { value: "pAgE 11" } });
  fireEvent.click(screen.getByRole("button", { name: "Page 11" }));
  expect(screen.getByRole("button", { name: "Page 11" })).toHaveAttribute("aria-pressed", "true");
  fireEvent.keyDown(search, { key: "Escape" });
  expect(search).toHaveValue("");
  expect(within(screen.getByRole("group", { name: "Used On" })).getAllByRole("button")).toHaveLength(12);
});
it("retains selected pages outside the initial six", () => {
  render(<UsedOnChoices options={options} selected="page-11" onSelect={() => {}} />);
  expect(screen.getByRole("button", { name: "Page 11" })).toHaveAttribute("aria-pressed", "true");
});