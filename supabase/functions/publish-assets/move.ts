// Pure helpers for publish-assets, kept separate so they can be unit tested.
export const MAX_IDS = 25;

export function parseIds(value: unknown): { ids: string[] } | { error: string } {
  if (!Array.isArray(value) || value.length === 0) return { error: "no_ids" };
  if (value.some((v) => typeof v !== "string")) return { error: "invalid_ids" };
  const ids = [...new Set(value as string[])];
  if (ids.length > MAX_IDS) return { error: "too_many_ids" };
  return { ids };
}

type StorageError = { message: string; statusCode?: string | number } | null;
export interface BucketApi {
  move(from: string, to: string, opts: { destinationBucket: string }): Promise<{ error: StorageError }>;
  remove(keys: string[]): Promise<{ error: StorageError }>;
  download(key: string): Promise<{ data: unknown; error: StorageError }>;
}
export type StorageApi = { from(bucket: string): BucketApi };

function alreadyExists(err: NonNullable<StorageError>) {
  return String(err.statusCode) === "409" || /already exists|duplicate/i.test(err.message);
}

/** Move one key between buckets. For "gate", also prove it is no longer publicly downloadable. */
export async function moveKey(
  storage: StorageApi, key: string, from: string, to: string, publicBucket: string, gate: boolean,
): Promise<string | null> {
  const mv = await storage.from(from).move(key, key, { destinationBucket: to });
  if (mv.error) {
    if (!alreadyExists(mv.error)) return mv.error.message;
    const rm = await storage.from(from).remove([key]);
    if (rm.error) return rm.error.message;
  }
  if (gate) {
    const dl = await storage.from(publicBucket).download(key);
    if (!dl.error) return "still public";
  }
  return null;
}
