import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { moveKey, parseIds, type StorageApi } from "./move.ts";

Deno.test("parseIds caps, de-duplicates and requires strings", () => {
  assertEquals(parseIds(["a", "a", "b"]), { ids: ["a", "b"] });
  assertEquals(parseIds(Array.from({ length: 26 }, (_, i) => `id${i}`)), { error: "too_many_ids" });
  assertEquals(parseIds(Array(30).fill("same")), { ids: ["same"] });
  assertEquals(parseIds(["a", 1]), { error: "invalid_ids" });
  assertEquals(parseIds([]), { error: "no_ids" });
});

function fake(opts: { move?: any; remove?: any; download?: any }) {
  const calls: string[] = [];
  const api: StorageApi = {
    from: (b) => ({
      move: async () => { calls.push(`move:${b}`); return { error: opts.move ?? null }; },
      remove: async () => { calls.push(`remove:${b}`); return { error: opts.remove ?? null }; },
      download: async () => { calls.push(`download:${b}`); return { data: opts.download ? null : {}, error: opts.download ?? null }; },
    }),
  };
  return { api, calls };
}

Deno.test("gate succeeds only when public download fails", async () => {
  const gone = fake({ download: { message: "not found" } });
  assertEquals(await moveKey(gone.api, "k", "pub", "gated", "pub", true), null);
  const still = fake({});
  assertEquals(await moveKey(still.api, "k", "pub", "gated", "pub", true), "still public");
});

Deno.test("existing destination removes the source; failures propagate", async () => {
  const exists = fake({ move: { message: "The resource already exists", statusCode: "409" }, download: { message: "nf" } });
  assertEquals(await moveKey(exists.api, "k", "pub", "gated", "pub", true), null);
  assertEquals(exists.calls.includes("remove:pub"), true);
  const rmFail = fake({ move: { message: "already exists" }, remove: { message: "denied" } });
  assertEquals(await moveKey(rmFail.api, "k", "a", "b", "b", false), "denied");
  const mvFail = fake({ move: { message: "boom" } });
  assertEquals(await moveKey(mvFail.api, "k", "a", "b", "b", false), "boom");
});
