import { describe, expect, it } from "vitest";
import { canScheduleMarket, isFeedSessionOpen, sessionAt } from "../src/calendar";

const et = (iso: string) => Date.parse(iso); // pass explicit offsets

describe("feed session calendar", () => {
  it("classifies weekday sessions (EST, -05:00)", () => {
    expect(sessionAt(et("2026-11-24T10:00:00-05:00"))).toBe("regular");
    expect(sessionAt(et("2026-11-24T05:00:00-05:00"))).toBe("pre-market");
    expect(sessionAt(et("2026-11-24T17:00:00-05:00"))).toBe("post-market");
    expect(sessionAt(et("2026-11-24T23:00:00-05:00"))).toBe("overnight");
  });

  it("is closed from Fri 20:00 to Sun 20:00 ET", () => {
    expect(isFeedSessionOpen(et("2026-11-20T19:59:00-05:00"))).toBe(true);
    expect(isFeedSessionOpen(et("2026-11-20T20:00:00-05:00"))).toBe(false);
    expect(isFeedSessionOpen(et("2026-11-22T12:00:00-05:00"))).toBe(false);
    expect(isFeedSessionOpen(et("2026-11-22T20:00:00-05:00"))).toBe(true);
  });

  it("is closed on NYSE holidays including the overnight session leading into them", () => {
    // Thanksgiving 2026-11-26
    expect(isFeedSessionOpen(et("2026-11-26T12:00:00-05:00"))).toBe(false);
    expect(isFeedSessionOpen(et("2026-11-25T21:00:00-05:00"))).toBe(false);
    expect(isFeedSessionOpen(et("2026-11-26T21:00:00-05:00"))).toBe(true);
  });

  it("handles DST (EDT, -04:00)", () => {
    expect(sessionAt(et("2026-07-15T09:45:00-04:00"))).toBe("regular");
  });

  it("refuses to schedule markets that close in a closed session", () => {
    const fri3pm = et("2026-11-20T15:00:00-05:00");
    expect(canScheduleMarket(fri3pm, fri3pm + 3600_000)).toBe(true);
    expect(canScheduleMarket(fri3pm, fri3pm + 86_400_000)).toBe(false);
  });
});
