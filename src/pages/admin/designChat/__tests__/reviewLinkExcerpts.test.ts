import { expect, it } from "vitest";
import { linkText } from "../linkCheck";
import { parseInventory } from "../linkInventory";

it("uses visible wording instead of a destination name and keeps it across edits", () => {
  const link = { href: "/contact", kind: "internal" as const, label: "Book a Consultation", ariaLabel: "Contact" };
  expect(linkText(link)).toBe("Book a Consultation");
  expect(linkText({ ...link, href: "/team" })).toBe("Book a Consultation");
});
it("uses the reported first heading and trims the excerpt to 40 characters", () => {
  const text = "Lighting Design Services for Every Room in Your Home";
  expect(linkText({ href: "/team", kind: "internal", label: "Many elements", visibleText: text })).toBe(text.slice(0, 39).trimEnd() + "…");
});
it("uses image alt or the reported filename without guessing missing image content", () => {
  expect(linkText({ href: "/team", kind: "internal", image: { alt: "Dining Room", src: "https://images.example/dining.jpg" } })).toBe("Image: Dining Room");
  expect(linkText({ href: "/team", kind: "internal", image: { alt: "", src: "https://images.example/dining.jpg" } })).toBe("Image: dining.jpg");
  expect(linkText({ href: "/team", kind: "internal", image: { alt: "" } })).toBe("Image");
});
it("accepts bounded optional image/heading metadata but excludes unsafe thumbnail schemes", () => {
  const payload = { source: "nova-site", type: "link-inventory", v: 1, path: "/", links: [{ key: "0", scope: "page", href: "/team", label: null, visibleText: "Lighting Design Services", image: { alt: "Dining", src: "javascript:bad()" } }] };
  expect(parseInventory(payload)?.links[0]).toMatchObject({ visibleText: "Lighting Design Services", image: { alt: "Dining" } });
  expect(parseInventory(payload)?.links[0].image).not.toHaveProperty("src");
});