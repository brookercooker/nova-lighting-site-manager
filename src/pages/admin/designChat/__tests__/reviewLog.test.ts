import { describe, expect, it } from "vitest";
import { groupedLog, publishedNet, reviewDisplayCount } from "../reviewLog";
import type { RelayState } from "../helper";

const requests = [
  { id: "a", source: "content", at: 100, request: "", details: ['Site Footer: Changed link: Ideas & Advice to /team'] },
  { id: "b", source: "content", at: 101, request: "", details: ['Site Footer: Changed link: Ideas & Advice to /about'] },
  { id: "c", source: "content", at: 102, request: "", details: ['Site Footer: restored the original link on the link "Ideas & Advice"'] },
];
const state = (items?: unknown, baseline = "published") => ({ publish: { open: 14 }, draft: { requests, ...(items === undefined ? {} : { netChanges: { baseline, items } }) } }) as unknown as RelayState;
const item = (id: string, changed: boolean) => ({ id, changed, summary: id === "footer" ? "Site Footer: Ideas & Advice link" : id, requestIds: id === "footer" ? ["a", "b", "c"] : [] });
describe("compact published-baseline log", () => {
  it("presents repeated footer link saves and restore in one entry without inventing a net result", () => {
    const log = groupedLog(requests);
    expect(log).toHaveLength(1);
    expect(log[0].requests.map(r => r.id)).toEqual(["c", "b", "a"]);
    expect(log[0].reverted).toBe(false);
    expect(reviewDisplayCount(state())).toBe(14);
  });
  it("excludes proven restored footer links from the shared count while retaining reverted details", () => {
    const s = state([item("footer", false), item("text", true), item("picture", true), item("chat", true)]);
    expect(reviewDisplayCount(s)).toBe(3);
    expect(publishedNet(s)?.entries.filter(e => e.reverted).map(e => e.key)).toEqual(["footer"]);
    expect(publishedNet(s)?.entries[0].requests).toHaveLength(3);
  });
  it("does not count a text edit later reverted to published wording", () => {
    expect(reviewDisplayCount(state([item("text", false)]))).toBe(0);
  });
  it("retains separate chat prompts rather than grouping them by wording", () => {
    expect(groupedLog([{ id: "a", request: "Warm it up" }, { id: "b", request: "Warm it up" }])).toHaveLength(2);
  });
  it.each([undefined, [], [item("x", true), item("x", false)], [{ ...item("x", true), changed: "false" }], [{ ...item("x", true), requestIds: [7] }]].map(items => ({ items })))("falls back safely without a valid complete inventory: %j", ({ items }) => {
    const s = Array.isArray(items) && items.length === 0 ? state(items, "draft") : state(items);
    expect(publishedNet(s)).toBeNull();
    expect(reviewDisplayCount(s)).toBe(14);
  });
});