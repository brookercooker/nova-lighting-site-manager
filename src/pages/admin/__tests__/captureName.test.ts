import { describe, expect, it } from "vitest";
import { captureNameSchema, sanitizeCaptureName } from "../captureName";

describe("Capture names", () => {
  it.each(["", "   "])("uses the original filename for blank input %j", name => {
    expect(sanitizeCaptureName(name, "photo.jpg")).toBe("photo.jpg");
  });
  it("trims names", () => expect(sanitizeCaptureName("  living room.jpg  ")).toBe("living room.jpg"));
  it("limits names to 80 characters", () => expect(sanitizeCaptureName("a".repeat(400) + ".jpg")).toBe("a".repeat(76) + ".jpg"));
  it.each([["../../etc/passwd", "etcpasswd"], ["a/b\\c", "abc"], ["<script>alert(1)</script>", "scriptalert(1)script"], ["a\u0000\n\tb", "ab"]])("strips unsafe characters from %j", (name, safe) => {
    expect(sanitizeCaptureName(name)).toBe(safe);
    expect(captureNameSchema.safeParse(name).success).toBe(false);
  });
});