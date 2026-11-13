import { expect, it } from "vitest";
import { pagePeekImage } from "../pagePeek";
it("uses the first actual saved page image ahead of a page snapshot", () => expect(pagePeekImage({ name: "Contact", path: "/contact", build_status: "ready", thumbnail_url: "/snapshot.jpg", content: [{ type: "image", url: "/first.jpg" }, { type: "image", url: "/second.jpg" }] })).toBe("/first.jpg"));
it("omits missing images rather than fetching a destination", () => expect(pagePeekImage({ name: "About", path: "/about", build_status: "ready" })).toBeNull());
it("rejects unsafe stored image addresses", () => expect(pagePeekImage({ name: "About", path: "/about", build_status: "ready", thumbnail_url: "javascript:bad()" })).toBeNull());