import { expect, it } from "vitest";
import { retainInventoryMetadata, type Inventory } from "../linkInventory";
const previous: Inventory = { path:"/", links:[{key:"0",scope:"page",href:"/gallery",label:"BOOK A CONSULTATION",originalHref:"/contact",image:{alt:"Consultation",src:"https://example.com/image.jpg"}}] };
it("retains previous page metadata across failed refreshes",()=>expect(retainInventoryMetadata(null,previous)).toEqual(previous));
it("retains swap original and wording for unchanged identity with incomplete metadata",()=>expect(retainInventoryMetadata({path:"/",links:[{key:"0",scope:"page",href:"/gallery",label:null}]},previous)?.links[0]).toMatchObject({label:"BOOK A CONSULTATION",originalHref:"/contact",image:previous.links[0].image}));
it("never revives removed inventory links",()=>expect(retainInventoryMetadata({path:"/",links:[]},previous)?.links).toEqual([]));
it("never supplies previous destination metadata to a changed link",()=>expect(retainInventoryMetadata({path:"/",links:[{key:"0",scope:"page",href:"/team",label:null}]},previous)?.links[0].originalHref).toBeUndefined());
it("does not mix another page's inventory",()=>expect(retainInventoryMetadata({path:"/about",links:[]},previous)?.path).toBe("/about"));
