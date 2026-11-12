import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { addTagsSafely, fillRequiredFields } from "./requiredFields.ts";

Deno.test("dropdown and radio take the first choice", () => {
  const out = fillRequiredFields([
    { tag: "D", type: "dropdown", required: true, options: { choices: ["A", "B"] } },
    { tag: "R", type: "radio", required: true, options: { choices: ["X"] } },
  ], {});
  assertEquals(out, { D: "A", R: "X" });
});
Deno.test("number gets 0", () => {
  assertEquals(fillRequiredFields([{ tag: "N", type: "number", required: true }], {}), { N: 0 });
});
Deno.test("address gets placeholder address", () => {
  assertEquals(fillRequiredFields([{ tag: "ADDR", type: "address", required: true }], {}), {
    ADDR: { addr1: "N/A", city: "-", state: "-", zip: "-", country: "US" },
  });
});
Deno.test("other types get N/A, including empty strings; optional fields untouched", () => {
  assertEquals(fillRequiredFields([
    { tag: "T", type: "text", required: true },
    { tag: "E", type: "text", required: true },
    { tag: "O", type: "text", required: false },
  ], { E: "" }), { T: "N/A", E: "N/A" });
});
Deno.test("already supplied fields are kept", () => {
  assertEquals(fillRequiredFields([{ tag: "FNAME", type: "text", required: true }], { FNAME: "Ann" }), { FNAME: "Ann" });
});
Deno.test("malformed definitions leave merge_fields unchanged", () => {
  assertEquals(fillRequiredFields(null, { A: "1" }), { A: "1" });
  assertEquals(fillRequiredFields("bad", {}), {});
  assertEquals(fillRequiredFields([null, 5, { required: true }, { tag: "D", type: "dropdown", required: true, options: null }], {}), {});
});
Deno.test("tag failure is logged and does not throw", async () => {
  const logs: unknown[] = [];
  assertEquals(await addTagsSafely(async () => new Response("{}", { status: 400 }), (...a) => logs.push(a)), false);
  assertEquals(await addTagsSafely(() => Promise.reject(new Error("net")), (...a) => logs.push(a)), false);
  assertEquals(logs.length, 2);
  assertEquals(await addTagsSafely(async () => new Response("{}", { status: 200 })), true);
});
