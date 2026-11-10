import { validSalesTaxCertPath } from "./validation.ts";

Deno.test("certificate paths accept the prescribed characters and 251-character maximum", () => {
  for (const path of ["a", "uploads/cert_1.pdf", "A" + "a".repeat(250)]) {
    if (!validSalesTaxCertPath(path)) throw new Error("Valid certificate path rejected");
  }
});

Deno.test("certificate paths reject traversal, double slashes and characters outside the prescribed set", () => {
  for (const path of ["", "/cert.pdf", "../cert.pdf", "a/../cert.pdf", "a//cert.pdf", "a%2fb.pdf", "a?b.pdf", "a#b.pdf", " a.pdf", "A" + "a".repeat(251)]) {
    if (validSalesTaxCertPath(path)) throw new Error("Invalid certificate path accepted");
  }
});