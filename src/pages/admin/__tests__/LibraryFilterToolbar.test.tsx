import { useState } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import LibraryFilterToolbar from "../LibraryFilterToolbar";
import { clearLibraryFilters } from "../libraryFilters";
const h=vi.hoisted(()=>({applied:vi.fn(),phone:true}));
vi.mock("../designChat/useManagerLayout",()=>({useManagerLayout:()=>({phone:h.phone})}));
vi.mock("../useAllLabels",()=>({useInvalidateLabels:()=>()=>{},registerLabelPath:vi.fn(),useLabelsForScope:()=>({data:[{path:"footer",name:"Footer",color_index:0},{path:"room",name:"Room",color_index:1}]})}));
afterEach(()=>{cleanup();h.applied.mockClear();h.phone=true;});
function Harness(){const [f,setF]=useState(clearLibraryFilters());return <LibraryFilterToolbar scope="objects" noun="Objects" search="" onSearch={()=>{}} value={f} onApply={next=>{h.applied(next);setF(next);}} fields={[{v:"all",label:"All Fields"},{v:"name",label:"Name"}]} sort="newest" onSort={()=>{}} sortOptions={[{v:"newest",label:"Recently Modified"}]} count={8} countResults={next=>next.labels.length ? 3 : 8} extraLabel="Used On" extraOptions={[{v:"all",label:"Any"},{v:"used",label:"In Use"},{v:"none",label:"Not Used"}]} onAdd={()=>{}} onEdit={()=>{}} editing={false}/>;}
describe("staged library panel",()=>{
  it("removes the floating Add command during Edit without changing the desktop Add command",()=>{
    const props = {scope:"objects" as const,noun:"Objects",search:"",onSearch:()=>{},value:clearLibraryFilters(),onApply:()=>{},fields:[],sort:"newest",onSort:()=>{},sortOptions:[],count:0,countResults:()=>0,onAdd:()=>{},onEdit:()=>{}};
    const {rerender}=render(<LibraryFilterToolbar {...props} editing={false}/>);
    expect(screen.getAllByRole("button",{name:"Add Object"})).toHaveLength(2);
    rerender(<LibraryFilterToolbar {...props} editing/>);
    expect(screen.getAllByRole("button",{name:"Add Object"})).toHaveLength(1);
  });
  it("opens the existing manager from the Labels section and scoped header event",()=>{
    render(<Harness/>);fireEvent.click(screen.getByRole("button",{name:"Filter"}));
    fireEvent.click(screen.getByRole("button",{name:"Manage Labels"}));expect(screen.getByRole("heading",{name:"Manage Labels"})).toBeInTheDocument();
    cleanup();render(<Harness/>);fireEvent(window,new CustomEvent("nova:manage-library-labels",{detail:"images"}));expect(screen.queryByRole("heading",{name:"Manage Labels"})).toBeNull();
    fireEvent(window,new CustomEvent("nova:manage-library-labels",{detail:"objects"}));expect(screen.getByRole("heading",{name:"Manage Labels"})).toBeInTheDocument();
  });
  it("applies labels immediately without a second Done and keeps them on closing",()=>{
    render(<Harness/>);fireEvent.click(screen.getByRole("button",{name:"Filter"}));
    fireEvent.click(screen.getByRole("button",{name:"Footer"}));
    expect(screen.getByRole("button",{name:"Show 3 Results"})).toBeEnabled();expect(h.applied).toHaveBeenLastCalledWith({...clearLibraryFilters(),labels:["footer"]});
    expect(within(screen.getByRole("dialog")).queryByRole("button",{name:"Done"})).toBeNull();
    fireEvent.click(screen.getByRole("button",{name:"Close Filters"}));
    fireEvent.click(screen.getByRole("button",{name:"Filter: 1 Active"}));
    expect(screen.getByRole("button",{name:"Remove footer"})).toHaveAttribute("aria-pressed","true");
  });
  it("commits only on Show Results and removal clears only that chip",()=>{
    render(<Harness/>);fireEvent.click(screen.getByRole("button",{name:"Filter"}));fireEvent.click(screen.getByRole("button",{name:"Footer"}));fireEvent.click(screen.getByRole("button",{name:"Show 3 Results"}));
    expect(h.applied).toHaveBeenLastCalledWith({...clearLibraryFilters(),labels:["footer"]});
    fireEvent.click(screen.getByRole("button",{name:"footer Remove"}));expect(h.applied).toHaveBeenLastCalledWith(clearLibraryFilters());
  });
  it("custom validation blocks apply while in-place labels stay in the same panel",()=>{
    render(<Harness/>);fireEvent.click(screen.getByRole("button",{name:"Filter"}));fireEvent.click(screen.getByRole("button",{name:"Custom"}));
    fireEvent.change(screen.getByLabelText("From"),{target:{value:"2026-11-14"}});fireEvent.change(screen.getByLabelText("To"),{target:{value:"2026-11-13"}});
    expect(screen.getByRole("button",{name:"Show 0 Results"})).toBeDisabled();
    expect(within(screen.getByRole("dialog")).getByRole("textbox",{name:"Search Labels"})).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button",{name:"Clear Dates"}));expect(screen.getByRole("button",{name:"Show 8 Results"})).toBeEnabled();
  });
});