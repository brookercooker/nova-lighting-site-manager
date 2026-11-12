// Helpers for landing page schedule dates.
// Campaign dates are calendar dates in the user's local time — never UTC-shifted.

/** Combine a "YYYY-MM-DD" date and optional "HH:MM" time into an ISO string
 *  representing that local wall-clock moment. */
export function localDateToIso(date: string, time?: string): string | null {
  if (!date) return null;
  const t = time && /^\d{2}:\d{2}$/.test(time) ? time : "00:00";
  // `new Date("YYYY-MM-DDTHH:MM")` parses as local time.
  const d = new Date(`${date}T${t}:00`);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

/** Optional schedule dates; a finite end must be strictly later than a finite start. */
export function landingScheduleCheck(start: string | null, end: string | null, alwaysOn: boolean, now = Date.now()) {
  const startMs = start ? Date.parse(start) : NaN;
  const endMs = !alwaysOn && end ? Date.parse(end) : NaN;
  const invalidOrder = Number.isFinite(startMs) && Number.isFinite(endMs) && endMs <= startMs;
  return { invalidOrder, expired: !invalidOrder && Number.isFinite(endMs) && endMs < now };
}

/** Split a stored ISO back into { date: "YYYY-MM-DD", time: "HH:MM" } in local time. */
export function isoToLocalParts(iso: string | null): { date: string; time: string } {
  if (!iso) return { date: "", time: "" };
  const d = new Date(iso);
  if (isNaN(d.getTime())) return { date: "", time: "" };
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return { date, time };
}

/** True when the stored moment is exactly local midnight (i.e. no specific time was set). */
export function isDateOnly(iso: string | null): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  return d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0;
}

/** Format a scheduled instant. Date-only unless a specific time was set. */
export function formatSchedule(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isDateOnly(iso)) {
    return d.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
  }
  return d.toLocaleString(undefined, {
    month: "long", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

/** Short form for table cells. */
export function formatScheduleShort(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isDateOnly(iso)) {
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  }
  return d.toLocaleString(undefined, {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}
