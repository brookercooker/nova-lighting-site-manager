import { supabase } from "@/prototype/client";

/** Update one page or object row and confirm the database actually stored it.
 * An update the database silently skips (no permission, row missing) comes back as an error, never as success. */
export async function saveRow(table: "pages" | "object_registry", patch: Record<string, unknown>, id: string, expectedUpdatedAt?: string): Promise<{ error: { message: string } | null }> {
  try {
    let update = (supabase as any).from(table).update(patch).eq("id", id);
    if (expectedUpdatedAt) update = update.eq("updated_at", expectedUpdatedAt);
    const { data, error } = await update.select("id");
    if (error) return { error: { message: error.message ?? "Couldn't save your changes." } };
    if (!Array.isArray(data) || data.length === 0) return { error: { message: expectedUpdatedAt ? "This page changed while you were editing. Your link wasn't saved. Cancel and try again." : "Your changes weren't saved: the database didn't accept them. Please try again or sign in again." } };
    return { error: null };
  } catch (e) {
    return { error: { message: e instanceof Error ? `Your changes weren't saved: ${e.message}` : "Your changes weren't saved. Please try again." } };
  }
}

