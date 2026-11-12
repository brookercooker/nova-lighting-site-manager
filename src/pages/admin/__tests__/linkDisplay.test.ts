import { describe, expect, it } from "vitest";
import { linkHistoryLine, publicLinkAddress } from "../linkDisplay";
describe("safe link presentation", () => {
  it("strips credentials while preserving the destination query and fragment", () => {
    expect(publicLinkAddress("/gallery?__lovable_token=private&view=all#top")).toBe("/gallery?view=all#top");
    expect(publicLinkAddress("/gallery?view=all&__lovable_token=private#top")).toBe("/gallery?view=all#top");
  });
  it("formats old duplicated link history and bounds its label", () => {
    expect(linkHistoryLine('Homepage: changed the link "Book a Consultation" link to /gallery')).toBe("Homepage: Changed link: Book a Consultation to /gallery");
    expect(linkHistoryLine("Changed link link " + "a".repeat(80) + " to /gallery")).toBe("Changed link: " + "a".repeat(39) + "… to /gallery");
  });
});