import { beforeEach, expect, it } from "vitest";
import { walk, WALK_SESSION_KEY } from "../submitWalkthroughStore";
beforeEach(() => { sessionStorage.clear(); walk.reset(); });
it("retains fingerprinted approvals/opened tabs across reload, never transient editing", () => {
  walk.approve("page:/", "draft-1");
  walk.openedVerification("/|/contact", "own-1");
  walk.confirmLink("/|/contact", "link-1", true);
  walk.restoreSession();
  expect(walk.get().ticked).toEqual(["page:/"]);
  expect(walk.get().linkTicked).toEqual(["/|/contact"]);
  expect(walk.get().verificationOpened).toEqual({ "/|/contact": "own-1" });
  expect(walk.get().open).toBe(false);
  expect(walk.get().reviewEdit).toBeNull();
  walk.reconcile({ "page:/": "draft-2" }, { "/|/contact": "link-2" }, { "/|/contact": "own-2" });
  expect(walk.get().ticked).toEqual([]);
  expect(walk.get().linkTicked).toEqual([]);
  expect(walk.get().verificationOpened).toEqual({});
});
it("requires an actual opening before explicit Keep and clears on changed fingerprint", () => {
  walk.keepMissing("/|/missing", "own-1", "link-1");
  expect(walk.get().linkTicked).toEqual([]);
  walk.openedVerification("/|/missing", "own-1");
  expect(walk.get().linkTicked).toEqual([]);
  walk.keepMissing("/|/missing", "own-1", "link-1");
  walk.restoreSession();
  expect(walk.get().keptMissing).toEqual({ "/|/missing": "own-1" });
  expect(walk.get().linkTicked).toEqual(["/|/missing"]);
  walk.reconcile({}, { "/|/missing": "link-2" }, { "/|/missing": "own-2" });
  expect(walk.get().keptMissing).toEqual({});
  expect(walk.get().linkTicked).toEqual([]);
});
it("drops old wrong progress and malformed session data safely", () => {
  sessionStorage.setItem(WALK_SESSION_KEY, JSON.stringify({ v: 1, linkWrong: { k: "old" }, linkApprovals: { k: 12 } }));
  walk.restoreSession();
  expect(walk.get().linkTicked).toEqual([]);
  expect(walk.get()).not.toHaveProperty("linkWrong");
  walk.reset(); walk.restoreSession();
  expect(walk.get().linkApprovals).toEqual({});
});