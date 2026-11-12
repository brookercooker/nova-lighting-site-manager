import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { relaySecretMatches } from "./relaySecret.ts";

const S = "x".repeat(32);
Deno.test("relay secret requires a configured 32+ char secret and exact header", () => {
  assertEquals(relaySecretMatches(S, S), true);
  assertEquals(relaySecretMatches(S, S + "y"), false);
  assertEquals(relaySecretMatches(S, "x".repeat(31)), false);
  assertEquals(relaySecretMatches(S, null), false);
  assertEquals(relaySecretMatches("short", "short"), false);
  assertEquals(relaySecretMatches(undefined, ""), false);
});
