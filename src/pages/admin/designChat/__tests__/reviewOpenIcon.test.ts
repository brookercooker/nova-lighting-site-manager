import { afterEach, expect, it, vi } from "vitest";
import { openReviewIcon } from "../reviewOpenIcon";
import { walk } from "../submitWalkthroughStore";
afterEach(() => { vi.restoreAllMocks(); walk.reset(); });
it("cancels native navigation, opens synchronously, severs opener and retains signed draft paths", () => {
  const tab = { opener: window, document: document.implementation.createHTMLDocument(), close: vi.fn() };
  const open = vi.spyOn(window, "open").mockReturnValue(tab as unknown as Window);
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  const event = { preventDefault: vi.fn(), stopPropagation: vi.fn() }, success = vi.fn();
  expect(openReviewIcon(event, "https://public.example/draft/pricing?__lovable_token=test", success)).toBe(true);
  expect(event.preventDefault).toHaveBeenCalledOnce();
  expect(event.stopPropagation).toHaveBeenCalledOnce();
  expect(open).toHaveBeenCalledWith("about:blank", "_blank");
  expect(tab.opener).toBeNull();
  expect(tab.document.querySelector("a")?.href).toBe("https://public.example/draft/pricing?__lovable_token=test");
  expect(success).toHaveBeenCalledOnce();
});
it("blocked icons never navigate the Manager or record a successful opening", () => {
  vi.spyOn(window, "open").mockReturnValue(null);
  const event = { preventDefault: vi.fn(), stopPropagation: vi.fn() }, success = vi.fn(), before = window.location.href;
  expect(openReviewIcon(event, "https://public.example/pricing", success)).toBe(false);
  expect(event.preventDefault).toHaveBeenCalledOnce();
  expect(window.location.href).toBe(before);
  expect(success).not.toHaveBeenCalled();
  expect(walk.get().linkNote).toBe("Your browser blocked the new tab. Use the open icon on the tile.");
});