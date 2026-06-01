import type { WindowType } from "@/types";

export interface WindowBounds {
  windowStart: Date;
  windowEnd: Date;
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

const getZonedParts = (date: Date, timeZone: string) => {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  const parts = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    weekday: parts.weekday,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
};

/** Offset in ms: wall-clock time in `timeZone` minus UTC at `date`. */
const getTimezoneOffsetMs = (date: Date, timeZone: string): number => {
  const parts = getZonedParts(date, timeZone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - date.getTime();
};

const zonedWallClockToUtc = (
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string,
): Date => {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second);
  let offset = getTimezoneOffsetMs(new Date(utcGuess), timeZone);
  let result = new Date(utcGuess - offset);
  const refinedOffset = getTimezoneOffsetMs(result, timeZone);

  if (refinedOffset !== offset) {
    offset = refinedOffset;
    result = new Date(utcGuess - offset);
  }

  return result;
};

const addLocalDays = (year: number, month: number, day: number, days: number, timeZone: string) => {
  const anchor = zonedWallClockToUtc(year, month, day, 12, 0, 0, timeZone);
  const shifted = new Date(anchor.getTime() + days * 86_400_000);
  const parts = getZonedParts(shifted, timeZone);
  return { year: parts.year, month: parts.month, day: parts.day };
};

const addLocalMonths = (year: number, month: number, months: number) => {
  const total = year * 12 + (month - 1) + months;
  return { year: Math.floor(total / 12), month: (total % 12) + 1 };
};

export const toIso = (date: Date): string => date.toISOString();

export const getWindowBounds = (
  windowType: WindowType,
  timezone: string,
  referenceDate: Date = new Date(),
): WindowBounds => {
  const local = getZonedParts(referenceDate, timezone);
  const { year, month, day, weekday } = local;

  if (windowType === "day") {
    const windowStart = zonedWallClockToUtc(year, month, day, 0, 0, 0, timezone);
    const nextDay = addLocalDays(year, month, day, 1, timezone);
    const windowEnd = zonedWallClockToUtc(nextDay.year, nextDay.month, nextDay.day, 0, 0, 0, timezone);
    return { windowStart, windowEnd };
  }

  if (windowType === "week") {
    const dayIndex = WEEKDAY_INDEX[weekday] ?? 1;
    const daysFromMonday = (dayIndex + 6) % 7;
    const monday = addLocalDays(year, month, day, -daysFromMonday, timezone);
    const windowStart = zonedWallClockToUtc(monday.year, monday.month, monday.day, 0, 0, 0, timezone);
    const nextMonday = addLocalDays(monday.year, monday.month, monday.day, 7, timezone);
    const windowEnd = zonedWallClockToUtc(nextMonday.year, nextMonday.month, nextMonday.day, 0, 0, 0, timezone);
    return { windowStart, windowEnd };
  }

  const windowStart = zonedWallClockToUtc(year, month, 1, 0, 0, 0, timezone);
  const nextMonth = addLocalMonths(year, month, 1);
  const windowEnd = zonedWallClockToUtc(nextMonth.year, nextMonth.month, 1, 0, 0, 0, timezone);
  return { windowStart, windowEnd };
};
