export function validSalesTaxCertPath(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._\/-]{0,250}$/.test(value) && !value.includes("..") && !value.includes("//");
}