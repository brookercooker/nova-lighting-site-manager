import { describe, expect, it } from "vitest";
import { auditLinkTitle } from "../auditLinkTitle";

describe("audit title reduction", () => {
  it("caps a 400-character input at 60 characters including ellipsis", () => {
    const original = "a".repeat(400);
    expect(auditLinkTitle(original)).toBe("a".repeat(59) + "…");
    expect(original.length).toBe(400);
  });
  it("uses only the first line and normalizes whitespace", () => {
    expect(auditLinkTitle("  first   line\r\nsecond line")).toBe("first line");
  });
  it("does not shorten an already clean inventory-sized label", () => {
    expect(auditLinkTitle("a".repeat(54))).toBe("a".repeat(54));
  });
});