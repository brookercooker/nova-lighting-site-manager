import { describe, expect, it } from "vitest";
import { activeLibraryFilters, clearLibraryFilters, validLibraryDates } from "../libraryFilters";
const fields = [{v:"all",label:"All Fields"},{v:"name",label:"Name"}];
describe("shared applied library filters", () => {
  it("counts individual labels, date range, search scope, usage and archived without counting sort or query", () => {
    const f = {...clearLibraryFilters(), labels:["footer","photos/interior"],timeRange:"week",searchField:"name",extra:"none",archived:true};
    expect(activeLibraryFilters(f,fields,[{v:"none",label:"Not Used"}]).map(c=>c.id)).toEqual(["date","label:footer","label:photos/interior","extra","field","archived"]);
  });
  it("clears one selected hierarchical label without changing siblings", () => {
    const f={...clearLibraryFilters(),labels:["photos","footer"],extra:"none"};
    const chip=activeLibraryFilters(f,fields).find(c=>c.id==="label:photos");
    expect(chip?.clear(f)).toEqual({...f,labels:["footer"]});
  });
  it("allows equal dates and rejects reversed date bounds", () => {
    expect(validLibraryDates({...clearLibraryFilters(),dateFrom:"2026-11-13",dateTo:"2026-11-13"})).toBe(true);
    expect(validLibraryDates({...clearLibraryFilters(),dateFrom:"2026-11-14",dateTo:"2026-11-13"})).toBe(false);
  });
  it("clear all resets every filter including custom bounds and archive", () => {
    expect(activeLibraryFilters(clearLibraryFilters(),fields)).toEqual([]);
    expect(clearLibraryFilters()).toEqual({searchField:"all",labels:[],timeRange:"all",dateFrom:"",dateTo:"",archived:false,extra:"all"});
  });
});