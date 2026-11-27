/**
 * Feed-session calendar for Chainlink 24/5 tokenized equity feeds.
 *
 * Per Chainlink docs the feeds publish across pre-market, regular, post-market and overnight sessions
 * (Sun 20:00 ET -> Fri 20:00 ET) and hold the last value on weekends and US market holidays.
 *
 * Rule: a moment belongs to the "trading day" of its ET calendar date, or of the NEXT date if it is at or after
 * 20:00 ET. The moment is in-session iff that trading day is Mon–Fri and not an NYSE full-day holiday.
 *
 * This calendar is only used by off-chain schedulers to avoid creating markets that would close while the feed is
 * frozen. The contract's staleness check is the authoritative safety net.
 */

/** NYSE full-day closures (ET dates). Source: NYSE holiday calendar — re-verify yearly. */
export const NYSE_HOLIDAYS = new Set<string>([
  // 2026
  "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25", "2026-06-19",
  "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
  // 2027
  "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31", "2027-06-18",
  "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24",
]);

/** NYSE early closes (13:00 ET): regular session ends early; the rest of the day is treated as post-market. */
export const NYSE_EARLY_CLOSES = new Set<string>(["2026-11-27", "2026-12-24", "2027-11-26"]);

const etFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  weekday: "short",
});

interface EtParts {
  date: string;
  hour: number;
  minute: number;
  weekday: number; // 0 = Sun
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function etParts(ms: number): EtParts {
  const parts = Object.fromEntries(etFormatter.formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    weekday: WEEKDAYS[parts.weekday as string] ?? 0,
  };
}

function addDays(isoDate: string, days: number): { date: string; weekday: number } {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return { date: d.toISOString().slice(0, 10), weekday: d.getUTCDay() };
}

export type SessionName = "overnight" | "pre-market" | "regular" | "post-market" | "closed";

/** Whether the 24/5 feed is expected to be publishing at `ms`. */
export function isFeedSessionOpen(ms: number): boolean {
  return sessionAt(ms) !== "closed";
}

export function sessionAt(ms: number): SessionName {
  const p = etParts(ms);
  const tradingDay = p.hour >= 20 ? addDays(p.date, 1) : { date: p.date, weekday: p.weekday };
  if (tradingDay.weekday === 0 || tradingDay.weekday === 6) return "closed";
  if (NYSE_HOLIDAYS.has(tradingDay.date)) return "closed";
  const mins = p.hour * 60 + p.minute;
  if (mins >= 20 * 60 || mins < 4 * 60) return "overnight";
  if (mins < 9 * 60 + 30) return "pre-market";
  if (mins < 16 * 60) return NYSE_EARLY_CLOSES.has(tradingDay.date) && mins >= 13 * 60 ? "post-market" : "regular";
  return "post-market";
}

/** True if a market opened now and closing at `closeMs` can be expected to settle on a live price. */
export function canScheduleMarket(nowMs: number, closeMs: number, settlementDelayMs = 120_000): boolean {
  return isFeedSessionOpen(nowMs) && isFeedSessionOpen(closeMs) && isFeedSessionOpen(closeMs + settlementDelayMs);
}

/** Next moment (>= from) when the feed session opens, scanning in 15-minute steps up to 10 days. */
export function nextSessionOpen(fromMs: number): number | null {
  const step = 15 * 60_000;
  for (let t = fromMs, i = 0; i < 960; i++, t += step) if (isFeedSessionOpen(t)) return t;
  return null;
}

export const SESSION_LABELS: Record<SessionName, string> = {
  overnight: "Overnight session (thin liquidity, smoothed price)",
  "pre-market": "Pre-market session",
  regular: "Regular trading hours",
  "post-market": "Post-market session",
  closed: "Feed closed (weekend/holiday) — last value held",
};

/** Regular US trading hours (09:30–16:00 ET, NYSE trading days). Intraday feeds only publish then. */
export function isRegularSession(ms: number): boolean {
  return sessionAt(ms) === "regular";
}

/** Intraday markets must open and close (plus settlement delay) inside the same regular session. */
export function canScheduleIntraday(nowMs: number, closeMs: number, settlementDelayMs = 120_000): boolean {
  return isRegularSession(nowMs) && isRegularSession(closeMs + settlementDelayMs) && etParts(nowMs).date === etParts(closeMs + settlementDelayMs).date;
}

const FIVE_MIN = 5 * 60_000;

/** Next start of regular trading hours at or after `fromMs` (5-minute resolution; null if none within 10 days). */
export function nextRegularOpen(fromMs: number): number | null {
  const start = Math.ceil(fromMs / FIVE_MIN) * FIVE_MIN;
  for (let t = start, i = 0; i < 2880; i++, t += FIVE_MIN) if (isRegularSession(t)) return t;
  return null;
}

/** End of the current regular session (first moment after `fromMs` that is no longer regular hours), or null. */
export function regularSessionEnd(fromMs: number): number | null {
  if (!isRegularSession(fromMs)) return null;
  const start = Math.ceil((fromMs + 1) / FIVE_MIN) * FIVE_MIN;
  for (let t = start, i = 0; i < 200; i++, t += FIVE_MIN) if (!isRegularSession(t)) return t;
  return null;
}

/** "Mon 9:30 AM ET" style label. */
export function formatEt(ms: number): string {
  return `${new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "2-digit" }).format(new Date(ms))} ET`;
}
