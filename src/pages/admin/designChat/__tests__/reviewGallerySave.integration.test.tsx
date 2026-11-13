import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({ row: { id: "home", name: "Homepage", updated_at: "version-1", inline_edits: {} as Record<string, string> }, notify: vi.fn() }));
vi.mock("@/prototype/client", () => ({ supabase: { from: () => {
  let patch: any = null; let expected: string | undefined;
  const query: any = {
    update: (value: any) => { patch = value; return query; },
    eq: (key: string, value: string) => { if (key === "updated_at") expected = value; return query; },
    select: () => patch ? Promise.resolve(expected !== db.row.updated_at ? { data: [] } : (db.row = { ...db.row, ...patch }, { data: [{ id: db.row.id }] })) : query,
    maybeSingle: async () => ({ data: db.row, error: null }),
  }; return query;
} } }));
vi.mock("../linkInventory", () => ({ requestFrameInventory: async () => null, requestInventory: async () => ({ path: "/", links: [{ key: "0.5.0.0", scope: "page", href: "/inspiration-gallery", originalHref: "/contact", label: "BOOK A CONSULTATION", target: null, fingerprint: '{"v":1,"tag":"div","t":"card"}' }] }) }));
vi.mock("../DesignChatContext", () => ({ useDesignChat: () => ({ preview: null }) }));
vi.mock("../useManagerLayout", () => ({ useManagerLayout: () => ({ phone: false }) }));
vi.mock("../linkFix", () => ({ useChangeLink: () => vi.fn() }));
vi.mock("../contentSync", () => ({ notifyContentEdited: db.notify }));
import { ReviewLinkEditor } from "../ReviewLinkEditor";
import { walk } from "../submitWalkthroughStore";
import { linkState } from "../linkCheck";
beforeEach(() => { walk.reset(); db.notify.mockClear(); db.row = { id: "home", name: "Homepage", updated_at: "version-1", inline_edits: { "link:0.5.0.0": '{"href":"/inspiration-gallery"}', "html:0.1": "preserved" } }; });
afterEach(cleanup);
it("saves the unambiguous Gallery row through real resolver/saveRow and reads replacement/new verification back", async () => {
  const link = { key: "/|/inspiration-gallery", href: "/inspiration-gallery", kind: "internal" as const, label: "Link to Inspiration Gallery", requestIds: [], status: null };
  const group = { page: { name: "Homepage", path: "/" }, label: "Homepage", links: [link] };
  walk.editLink({ link, group, rows: [], fingerprint: "gallery-own" });
  render(<ReviewLinkEditor pages={[]} />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Save New Link" })).toBeEnabled());
  fireEvent.change(screen.getByLabelText("New Destination"), { target: { value: "/contact" } });
  fireEvent.click(screen.getByRole("button", { name: "Save New Link" }));
  await waitFor(() => expect(db.notify).toHaveBeenCalled());
  expect(JSON.parse(db.row.inline_edits["link:0.5.0.0"])).toEqual({ href: "/contact" });
  expect(db.row.inline_edits["fp:0.5.0.0"]).toBe('{"v":1,"tag":"div","t":"card"}');
  expect(db.row.inline_edits["html:0.1"]).toBe("preserved");
  expect(linkState(link.key, walk.get().linkTicked, walk.get().linkReplaced)).toBe("todo");
  const next = walk.get().savedReviewLinks[0].link;
  expect(next).toMatchObject({ href: "/contact", elementKey: "0.5.0.0", scope: "page" });
  expect(linkState(next.key, walk.get().linkTicked, walk.get().linkReplaced)).toBe("todo");
});