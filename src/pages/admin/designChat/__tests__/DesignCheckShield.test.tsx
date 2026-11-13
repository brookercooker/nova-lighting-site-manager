import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DesignCheckShield } from "../DesignCheckShield";
import { walk } from "../submitWalkthroughStore";
const post = vi.hoisted(() => vi.fn());
vi.mock("../previewNavigate", () => ({ shownPreviewFrame: () => ({ src: "https://public.example/", contentWindow: { postMessage: post } }) }));
afterEach(() => { cleanup(); post.mockClear(); walk.reset(); });
it("scrolls the read-only canvas through the exact-origin protocol, with no navigation command", () => {
  render(<DesignCheckShield path="/" />);
  const canvas = screen.getByRole("region", { name: "Design Check Preview" });
  fireEvent.wheel(canvas, { deltaY: 240 });
  expect(post).toHaveBeenLastCalledWith({ source: "nova-manager", type: "restore-scroll", path: "/", y: 240 }, "https://public.example");
  fireEvent.keyDown(canvas, { key: "ArrowDown" });
  expect(post).toHaveBeenLastCalledWith({ source: "nova-manager", type: "restore-scroll", path: "/", y: 300 }, "https://public.example");
  fireEvent.click(canvas);
  expect(post).toHaveBeenCalledTimes(2);
});
it("fresh review entry clears manual attestations but retains fingerprinted approvals", () => {
  walk.update(w => ({ ...w, checks: ["pages", "links", "phone", "unintended"], approvals: { "page:/": "saved" }, ticked: ["page:/"] }));
  walk.open("panel");
  expect(walk.get().checks).toEqual([]);
  expect(walk.get().approvals).toEqual({ "page:/": "saved" });
});