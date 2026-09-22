/**
 * Meter periods are calendar months in the shop's IANA timezone, keyed as
 * "YYYY-MM". Uses the built-in Intl API so no date library is needed.
 */

export type PeriodKey = `${number}-${string}`;

interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timezone: string): Intl.DateTimeFormat {
  let formatter = formatterCache.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatterCache.set(timezone, formatter);
  }
  return formatter;
}

function zonedParts(date: Date, timezone: string): ZonedParts {
  const parts = formatterFor(timezone).formatToParts(date);
  const pick = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((p) => p.type === type);
    if (!part) throw new Error(`Missing ${type} when formatting in ${timezone}`);
    return Number(part.value);
  };
  return {
    year: pick("year"),
    month: pick("month"),
    day: pick("day"),
    hour: pick("hour"),
    minute: pick("minute"),
    second: pick("second"),
  };
}

/** Offset of `timezone` from UTC at `date`, in milliseconds. */
function offsetMs(date: Date, timezone: string): number {
  const p = zonedParts(date, timezone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** The UTC instant of local midnight on the given calendar day in `timezone`. */
function zonedMidnightUtc(
  year: number,
  month: number,
  day: number,
  timezone: string,
): Date {
  const guess = new Date(Date.UTC(year, month - 1, day));
  const corrected = new Date(guess.getTime() - offsetMs(guess, timezone));
  // A second pass handles the rare case where the offset differs at the
  // corrected instant (a DST change at midnight).
  return new Date(guess.getTime() - offsetMs(corrected, timezone));
}

/** "YYYY-MM" for the calendar month containing `now` in `timezone`. */
export function currentPeriod(timezone: string, now: Date = new Date()): PeriodKey {
  const { year, month } = zonedParts(now, timezone);
  return `${year}-${String(month).padStart(2, "0")}` as PeriodKey;
}

function parsePeriod(period: PeriodKey): { year: number; month: number } {
  const [y, m] = period.split("-").map(Number);
  if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12) {
    throw new Error(`Invalid period key: ${period}`);
  }
  return { year: y, month: m };
}

/** UTC instant when `period` starts in `timezone`. */
export function periodStart(period: PeriodKey, timezone: string): Date {
  const { year, month } = parsePeriod(period);
  return zonedMidnightUtc(year, month, 1, timezone);
}

/** UTC instant when `period` ends in `timezone` (start of the next month). */
export function periodEnd(period: PeriodKey, timezone: string): Date {
  const { year, month } = parsePeriod(period);
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  return zonedMidnightUtc(nextYear, nextMonth, 1, timezone);
}

/** Whole days left in the period, never below zero. */
export function daysRemaining(
  period: PeriodKey,
  timezone: string,
  now: Date = new Date(),
): number {
  const ms = periodEnd(period, timezone).getTime() - now.getTime();
  return Math.max(0, Math.ceil(ms / 86_400_000));
}
