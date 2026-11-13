import { afterEach, expect, it, vi } from "vitest";
import { openReviewDestination } from "../openReviewDestination";
const click = { raw: "/contact", href: "https://public.example/contact?__lovable_token=secret", kind: "internal" as const, label: "Contact", path: "/" };
afterEach(() => vi.restoreAllMocks());
it("severs opener before navigating with noopener/noreferrer and strips preview credentials", () => {
  const doc = document.implementation.createHTMLDocument();
  const tab = { opener: window, document: doc, close: vi.fn() };
  const open = vi.spyOn(window, "open").mockReturnValue(tab as unknown as Window);
  const activate = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function() {
    expect(tab.opener).toBeNull();
  });
  expect(openReviewDestination(click)).toBe(true);
  expect(open).toHaveBeenCalledWith("about:blank", "_blank");
  expect(doc.querySelector("a")?.href).toBe("https://public.example/contact");
  expect(doc.querySelector("a")?.rel).toBe("noopener noreferrer");
  expect(activate).toHaveBeenCalledOnce();
});
it("reports a blocked popup without navigating the Manager", () => {
  vi.spyOn(window, "open").mockReturnValue(null);
  expect(openReviewDestination(click)).toBe(false);
});
it.each(["javascript:alert(1)", "data:text/html,hello", "https://staff:password@example.com"]) ("never opens unsafe destination %s", href => {
  const open = vi.spyOn(window, "open");
  expect(openReviewDestination({ ...click, href })).toBe(false);
  expect(open).not.toHaveBeenCalled();
});