import { useState } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import UsedOnChoices from "../UsedOnChoices";
afterEach(cleanup);
const options = Array.from({ length: 12 }, (_, i) => ({ v: `page-${i}`, label: `Page ${i}` }));
it("searches pages immediately, selects a matching result and removes the selection", () => {
  function Harness() { const [selected, setSelected] = useState("page-0"); return <UsedOnChoices options={options} selected={selected} onSelect={setSelected} />; }
  render(<Harness />);
  const search = screen.getByRole("textbox", { name: "Find a Page" });
  fireEvent.change(search, { target: { value: "pAgE 11" } });
  fireEvent.click(screen.getByRole("button", { name: "Page 11" }));
  expect(screen.getByRole("button", { name: "Page 11" })).toHaveAttribute("aria-pressed", "true");
  fireEvent.keyDown(search, { key: "Escape" });
  expect(search).toHaveValue("");
  expect(within(screen.getByRole("group", { name: "Matching Pages" })).queryAllByRole("button")).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Remove Page 11" }));
  fireEvent.change(search, { target: { value: "Page 11" } });
  expect(screen.getByRole("button", { name: "Page 11" })).toHaveAttribute("aria-pressed", "false");
});
it("retains a selected page when the search has no matching results", () => {
  render(<UsedOnChoices options={options} selected="page-11" onSelect={() => {}} />);
  expect(screen.getByRole("button", { name: "Remove Page 11" })).toBeInTheDocument();
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "missing" } });
  expect(screen.getByRole("button", { name: "Remove Page 11" })).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("No pages match");
});