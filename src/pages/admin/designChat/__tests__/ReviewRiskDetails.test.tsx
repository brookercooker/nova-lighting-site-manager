import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ReviewDestination, ReviewRiskFlags } from "../ReviewLinkRiskDetails";
import { TrustedDomainList } from "../trustedDomains";
vi.mock("../../signedThumb",()=>({SignedThumbImg:({url}:{url:string})=><img src={url} alt="" />}));
afterEach(cleanup);
it("exposes one swap summary with secondary reasons and related focus inside details",()=>{
 const jump=vi.fn();render(<ReviewRiskFlags flags={[{kind:"mismatch",reason:"Wording may not match"},{kind:"swap",reason:"Looks swapped with BOOK A CONSULTATION",otherKey:"book"}]} onJump={jump}/>);
 expect(document.querySelectorAll("summary")).toHaveLength(1);
 expect(document.querySelector("summary")?.textContent).toBe("Looks swapped with BOOK A CONSULTATION");
 expect(document.querySelector("details")?.open).toBe(false);
 fireEvent.click(screen.getByText("Looks swapped with BOOK A CONSULTATION"));fireEvent.click(screen.getByRole("button",{name:"Show Related Link"}));expect(jump).toHaveBeenCalledWith("book");
});
it("page peek shows title/image without repeated path or publication guesses",()=>{
 render(<ReviewDestination link={{key:"a",href:"/contact",kind:"internal",label:"Contact",requestIds:[],status:null}} pages={[{name:"Contact",path:"/contact",build_status:"ready",status:"draft",thumbnail_url:"/contact.jpg"}]} flags={[]} trusted={false}/>);
 expect(screen.getAllByText("/contact")).toHaveLength(1);expect(document.querySelector("img")).toBeNull();expect(screen.queryByText("Not Published")).toBeNull();
});
it("trusted domains starts collapsed with its actual count",()=>{
 render(<TrustedDomainList trust={{domains:["example.com"],isAdmin:true,pending:false,error:"",change:vi.fn()}}/>);
 const toggle=screen.getByRole("button",{name:"Trusted Domains (1)"});expect(toggle).toHaveAttribute("aria-expanded","false");expect(screen.queryByText("example.com")).toBeNull();fireEvent.click(toggle);expect(screen.getByText("example.com")).toBeInTheDocument();
});
it("confirms untrust inline and Cancel never removes a shared domain",()=>{
 const change=vi.fn();render(<TrustedDomainList trust={{domains:["google.com"],records:[{domain:"google.com",author:"brooklyngull",created_by:"staff",created_at:"2026-11-12T12:00:00Z"}],isAdmin:true,pending:false,error:"",change}}/>);
 fireEvent.click(screen.getByRole("button",{name:"Trusted Domains (1)"}));
 fireEvent.click(screen.getByRole("button",{name:"Remove Trusted Domain: google.com"}));expect(change).not.toHaveBeenCalled();
 expect(screen.getByText("Stop trusting google.com? Links to it will need review again.")).toBeInTheDocument();
 expect(screen.getByText(/Added by brooklyngull/)).toBeInTheDocument();fireEvent.click(screen.getByRole("button",{name:"Cancel"}));expect(change).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole("button",{name:"Remove Trusted Domain: google.com"}));fireEvent.click(screen.getByRole("button",{name:"Stop Trusting"}));expect(change).toHaveBeenCalledWith("google.com",true);
});
