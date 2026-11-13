import { useState } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import LabelSearchList from "../LabelSearchList";
import { labelCount, libraryCount, matchingLabels, labelMatchParts } from "../labelSearch";
afterEach(cleanup);
const labels = Array.from({ length: 120 }, (_, i) => ({ path: `label-${i}`, name: `Label ${i}`, color_index: i % 16 }));
describe("shared label search", () => {
  it("retains independent selected label state and counts in chips and searched rows", () => {
    render(<LabelSearchList labels={labels} selected={["label-9"]} counts={{"label-9":12,"label-8":20}} onToggle={()=>{}} />);
    expect(screen.getByRole("button",{name:"Remove label-9"})).toHaveAttribute("aria-pressed","true");
    expect(screen.getByRole("button",{name:"Remove label-9"})).toHaveTextContent("12");
    expect(screen.getByRole("button",{name:"Label 8"})).toHaveAttribute("aria-pressed","false");
    fireEvent.change(screen.getByRole("textbox",{name:"Search Labels"}),{target:{value:"Label"}});
    expect(screen.getAllByRole("checkbox")[0]).toHaveAccessibleName("label-9");
    expect(screen.getAllByRole("checkbox")[0]).toHaveAttribute("aria-checked","true");
    expect(screen.getAllByRole("checkbox")[1]).toHaveAccessibleName("label-8");
  });
  it("uses singular item/result/label counts and no-label wording", () => {
    expect(labelCount(0)).toBe("No labels"); expect(labelCount(1)).toBe("1 label");
    for (const noun of ["objects", "pages", "images", "videos", "landing pages", "results"]) expect(libraryCount(1, noun)).toBe(`1 ${noun.slice(0, -1)}`);
    expect(libraryCount(1, "Results")).toBe("1 Result");
  });
  it("normalizes case/space, matches inside names, and highlights each match", () => {
    expect(matchingLabels(labels, " BeL 11 ", [], {}).map(l => l.path)).toEqual(["label-11", ...Array.from({length:10},(_,i)=>`label-${110+i}`)]);
    expect(labelMatchParts("Core core", "CORE")).toEqual([{text:"Core",match:true},{text:" ",match:false},{text:"core",match:true}]);
  });
  it("keeps selected first then ranks six popular choices and expands in place", () => {
    render(<LabelSearchList labels={labels} selected={["label-119"]} counts={{"label-8":20}} onToggle={()=>{}} />);
    const chips = within(screen.getByRole("group",{name:"Labels"})).getAllByRole("button");
    expect(chips[0]).toHaveAccessibleName("Remove label-119"); expect(chips[1]).toHaveAccessibleName("Label 8"); expect(chips).toHaveLength(8);
    fireEvent.click(screen.getByRole("button",{name:"+ More"}));
    expect(screen.getAllByRole("checkbox")).toHaveLength(120);
  });
  it("filters live, toggles with keyboard, preserves the search, and clears Escape first", () => {
    const closed=vi.fn(); function Harness(){const [selected,setSelected]=useState<string[]>([]);return <LabelSearchList labels={labels} selected={selected} onToggle={path=>setSelected(cur=>cur.includes(path)?cur.filter(p=>p!==path):[...cur,path])} onDone={closed}/>;}
    render(<Harness/>); const search=screen.getByRole("textbox",{name:"Search Labels"});
    fireEvent.change(search,{target:{value:"label 119"}}); expect(screen.getAllByRole("checkbox")).toHaveLength(1);
    expect(screen.getByRole("checkbox",{name:"label-119"}).querySelector("mark")?.textContent).toBe("Label 119");
    fireEvent.keyDown(search,{key:"ArrowDown"}); const row=screen.getByRole("checkbox",{name:"label-119"}); expect(row).toHaveFocus();
    fireEvent.keyDown(row,{key:"Enter"}); expect(row).toHaveAttribute("aria-checked","true");expect(search).toHaveValue("label 119");expect(closed).not.toHaveBeenCalled();
    fireEvent.keyDown(search,{key:"Escape"});expect(search).toHaveValue("");fireEvent.click(screen.getByRole("button",{name:"Done"}));expect(closed).toHaveBeenCalledOnce();
  });
  it("offers creation only when supported and nothing matches",()=>{
    const create=vi.fn();const {rerender}=render(<LabelSearchList labels={labels} selected={[]} onToggle={()=>{}} onCreate={create}/>);
    fireEvent.change(screen.getByRole("textbox",{name:"Search Labels"}),{target:{value:"xyz"}});
    expect(screen.getByText("No labels match 'xyz'")).toBeInTheDocument();fireEvent.click(screen.getByRole("button",{name:"Create 'xyz'"}));expect(create).toHaveBeenCalledWith("xyz");
    rerender(<LabelSearchList labels={labels} selected={[]} onToggle={()=>{}}/>);expect(screen.queryByRole("button",{name:"Create 'xyz'"})).toBeNull();
  });
});