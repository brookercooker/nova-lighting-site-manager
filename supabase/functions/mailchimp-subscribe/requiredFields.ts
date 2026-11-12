export interface MergeFieldDef {
  tag?: unknown;
  type?: unknown;
  required?: unknown;
  options?: { choices?: unknown } | null;
}

/** Fill required merge fields that are missing or empty with placeholders. Pure. */
export function fillRequiredFields(
  defs: unknown,
  current: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...current };
  if (!Array.isArray(defs)) return out;
  for (const raw of defs) {
    if (!raw || typeof raw !== 'object') continue;
    const f = raw as MergeFieldDef;
    if (f.required !== true || typeof f.tag !== 'string' || !f.tag) continue;
    if (out[f.tag] !== undefined && out[f.tag] !== '') continue;
    if (f.type === 'dropdown' || f.type === 'radio') {
      const choices = f.options?.choices;
      const first = Array.isArray(choices) ? choices[0] : undefined;
      if (first !== undefined && first !== null && first !== '') out[f.tag] = first;
    } else if (f.type === 'number') {
      out[f.tag] = 0;
    } else if (f.type === 'address') {
      out[f.tag] = { addr1: 'N/A', city: '-', state: '-', zip: '-', country: 'US' };
    } else {
      out[f.tag] = 'N/A';
    }
  }
  return out;
}

/** Add tags after the member exists; failures are logged, never thrown. */
export async function addTagsSafely(
  doFetch: () => Promise<Response>,
  log: (...a: unknown[]) => void = console.error,
): Promise<boolean> {
  try {
    const res = await doFetch();
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      log('Mailchimp tag error', res.status, err);
      return false;
    }
    return true;
  } catch (e) {
    log('Mailchimp tag request failed', e);
    return false;
  }
}
