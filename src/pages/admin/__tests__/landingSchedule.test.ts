import { describe, expect, it } from "vitest";
import { landingScheduleCheck, localDateToIso } from "@/lib/landingDates";

describe("landing schedule validation", () => {
  it("rejects December 1 end before December 10 start", () => {
    expect(landingScheduleCheck(localDateToIso("2026-12-10"), localDateToIso("2026-12-01"), false).invalidOrder).toBe(true);
  });
  it("requires the end to be strictly after start, including times", () => {
    const start = localDateToIso("2026-12-10", "12:00");
    expect(landingScheduleCheck(start, start, false).invalidOrder).toBe(true);
    expect(landingScheduleCheck(start, localDateToIso("2026-12-10", "12:01"), false).invalidOrder).toBe(false);
  });
  it("warns for a campaign entirely in 2020 without preventing creation", () => {
    const result = landingScheduleCheck(localDateToIso("2020-01-01"), localDateToIso("2020-02-01"), false, Date.parse("2026-11-12T21:28:00Z"));
    expect(result).toEqual({ invalidOrder: false, expired: true });
  });
  it("ignores end dates when Always on is checked", () => {
    expect(landingScheduleCheck(localDateToIso("2026-12-10"), localDateToIso("2020-01-01"), true)).toEqual({ invalidOrder: false, expired: false });
  });
});