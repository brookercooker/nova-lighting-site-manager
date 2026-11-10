import { allowedCaptureOrigin, managerCors, managerOrigins, validCapturePath } from "./managerSecurity.ts";

const allowed = managerOrigins("https://preview.example.test", "https://manager.example.test");
function assert(condition: boolean, message: string) { if (!condition) throw new Error(message); }

Deno.test("Manager CORS echoes only explicitly permitted origins and retains preflight headers", () => {
  for (const origin of allowed) {
    const cors = managerCors(new Request(origin, { headers: { Origin: origin } }), allowed);
    assert(cors["Access-Control-Allow-Origin"] === origin && cors.Vary === "Origin", "Allowed origin must be echoed");
  }
  for (const origin of ["https://attacker.lovable.app", "https://manager.example.test.evil.test", "null"]) {
    const cors = managerCors(new Request("https://function.example.test", { headers: { Origin: origin } }), allowed, "GET, POST, OPTIONS");
    assert(!("Access-Control-Allow-Origin" in cors) || !cors["Access-Control-Allow-Origin"], "Unlisted origin must not get CORS access");
    assert(cors["Access-Control-Allow-Methods"] === "GET, POST, OPTIONS" && !!cors["Access-Control-Allow-Headers"], "Preflight headers must remain");
  }
});

Deno.test("capture accepts only an exact allowed origin, never a token-bearing destination elsewhere", () => {
  assert(allowedCaptureOrigin("https://manager.example.test", allowed) === "https://manager.example.test", "Manager origin must work");
  for (const value of ["https://attacker.lovable.app", "https://manager.example.test@evil.test", "https://manager.example.test/path", "https://manager.example.test?x=1", "https://manager.example.test#fragment", "http://manager.example.test", null]) {
    assert(allowedCaptureOrigin(value, allowed) === null, "Unsafe capture origin accepted");
  }
});

Deno.test("capture paths must start with slash and contain neither double slash nor protocol", () => {
  assert(validCapturePath("/contact?preview=1"), "Relative page path must work");
  for (const path of ["contact", "//evil.test", "/foo//bar", "/https://evil.test", null]) {
    assert(!validCapturePath(path), "Unsafe capture path accepted");
  }
});