export const ALLOWED_TAGS = ["Newsletter", "Homepage", "contact us", "Test of Object"] as const;

/** Keep only allow-listed tags (exact match), de-duplicated, at most 3. */
export function allowedTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const allow = new Set<string>(ALLOWED_TAGS);
  return [...new Set(value.filter((t): t is string => typeof t === "string" && allow.has(t)))].slice(0, 3);
}

/** Merge fields come only from these named inputs; request mergeFields are ignored. */
export function buildMergeFields(body: Record<string, unknown>): Record<string, unknown> {
  const m: Record<string, unknown> = {};
  if (body.firstName) m.FNAME = String(body.firstName).slice(0, 100);
  if (body.lastName) m.LNAME = String(body.lastName).slice(0, 100);
  if (body.phone) m.PHONE = String(body.phone).slice(0, 40);
  if (body.address) {
    m.ADDRESS = { addr1: String(body.address).slice(0, 200), city: "-", state: "-", zip: "-", country: "US" };
  }
  return m;
}

export function isMemberExists(status: number, data: unknown): boolean {
  return status === 400 && (data as { title?: string } | null)?.title === "Member Exists";
}
