import { z } from "zod";

export const CAPTURE_NAME_MAX = 80;
export const captureNameSchema = z.string().trim().min(1).max(CAPTURE_NAME_MAX).refine(value => !/[\/\\<>\u0000-\u001f\u007f]/.test(value) && !/^\.+/.test(value));
/** Display names, not storage paths. Keep extensions when shortening an original name. */
export function sanitizeCaptureName(value: string, original = "upload") {
  const clean = (name: string) => name.replace(/[\/\\<>\u0000-\u001f\u007f]/g, "").trim().replace(/^\.+/, "").trim();
  let name = clean(value) || clean(original) || "upload";
  if (name.length > CAPTURE_NAME_MAX) {
    const ext = name.match(/\.[a-zA-Z0-9]{1,8}$/)?.[0] ?? "";
    name = name.slice(0, CAPTURE_NAME_MAX - ext.length).trimEnd() + ext;
  }
  return captureNameSchema.parse(name);
}