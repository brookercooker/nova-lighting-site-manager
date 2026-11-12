import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { allowedTags, buildMergeFields, isMemberExists } from "./rules.ts";

Deno.test("tags are allow-listed and capped at 3", () => {
  assertEquals(allowedTags(["Newsletter", "VIP", "Homepage", "contact us", "Test of Object"]), ["Newsletter", "Homepage", "contact us"]);
  assertEquals(allowedTags(["newsletter", 5, "Newsletter", "Newsletter"]), ["Newsletter"]);
  assertEquals(allowedTags("Newsletter"), []);
});

Deno.test("merge fields ignore request mergeFields", () => {
  assertEquals(buildMergeFields({ firstName: "A", mergeFields: { EVIL: "x" } }), { FNAME: "A" });
});

Deno.test("member exists detection", () => {
  assertEquals(isMemberExists(400, { title: "Member Exists" }), true);
  assertEquals(isMemberExists(400, { title: "Invalid Resource" }), false);
});
