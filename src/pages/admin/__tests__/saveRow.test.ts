import { describe, it, expect, vi, beforeEach } from "vitest";
const db = vi.hoisted(() => ({ result: { data: [{ id: "p1" }], error: null } as any, calls: [] as any[] }));
vi.mock("@/prototype/client", () => ({ supabase: { from: (table: string) => ({ update: (patch: any) => {
  const filters: any[] = [];
  const q = { eq: (c: string, value: string) => { filters.push([c, value]); return q; }, select: async () => { db.calls.push({ table, patch, id: filters[0]?.[1], filters }); return db.result; } };
  return q;
} }) } }));
import { saveRow } from "../saveRow";
import { insertPickedBlock } from "../pageInsertion";
import { stripHeldObjects } from "../framedPageProtocol";
import { isInternalPath, pageToRegister } from "../designChat/registerPage";

beforeEach(() => { db.calls = []; db.result = { data: [{ id: "p1" }], error: null }; });

describe("saving an added object", () => {
  it("writes pages.content containing the added object block", async () => {
    const block = { id: "b1", type: "object", objectId: "obj-1", name: "Spotlight", align: "left" } as any;
    const next = insertPickedBlock([], block, 0);
    const { error } = await saveRow("pages", { content: stripHeldObjects(next) }, "p1");
    expect(error).toBeNull();
    expect(db.calls[0].table).toBe("pages");
    expect(db.calls[0].id).toBe("p1");
    expect(db.calls[0].patch.content).toEqual([expect.objectContaining({ type: "object", objectId: "obj-1" })]);
  });
  it("an update the database silently skips is a failure, not a success", async () => {
    db.result = { data: [], error: null };
    expect((await saveRow("pages", { content: [] }, "p1")).error).not.toBeNull();
  });
  it("a database error is reported", async () => {
    db.result = { data: null, error: { message: "denied" } };
    expect((await saveRow("pages", { content: [] }, "p1")).error?.message).toBe("denied");
  });
  it("uses the opened timestamp to reject a concurrent review-link save", async () => {
    db.result = { data: [], error: null };
    const out = await saveRow("pages", { inline_edits: {} }, "p1", "2026-11-12T20:00:00Z");
    expect(db.calls[0].filters).toEqual([["id", "p1"], ["updated_at", "2026-11-12T20:00:00Z"]]);
    expect(out.error?.message).toContain("changed while you were editing");
  });
});

describe("page registration skips editor addresses", () => {
  it.each(["/__object/dfff040f-a387-494d-af9d-cc10e3955b8e", "/__object/site-header", "/manage", "/manage/preview", "/admin", "/preview", "/preview/x"])("%s is never registered", (p) => {
    expect(isInternalPath(p)).toBe(true);
    expect(pageToRegister(p)).toBeNull();
  });
  it("visitor pages still register", () => {
    expect(pageToRegister("/draft")).toEqual({ name: "Draft", path: "/draft" });
    expect(isInternalPath("/managers-picks")).toBe(false);
  });
});
