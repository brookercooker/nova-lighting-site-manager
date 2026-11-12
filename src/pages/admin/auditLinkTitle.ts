/** Compact audit wording without changing the stored identity or search text. */
export function auditLinkTitle(text: string): string {
  const firstLine = text.trim().split(/[\r\n]/, 1)[0].replace(/\s+/g, " ");
  return firstLine.length > 60 ? `${firstLine.slice(0, 59).trimEnd()}…` : firstLine;
}