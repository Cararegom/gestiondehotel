export const DEFAULT_BANK_TIME_ZONE = "America/Bogota";

function validTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

export function normalizeBankTimeZone(value: unknown, fallback = DEFAULT_BANK_TIME_ZONE): string {
  const candidate = typeof value === "string" ? value.trim() : "";
  return candidate && validTimeZone(candidate) ? candidate : fallback;
}

function dateTimeParts(value: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);
  const read = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour"),
    minute: read("minute"),
    second: read("second"),
  };
}

function timeZoneOffsetMs(value: Date, timeZone: string): number {
  const parts = dateTimeParts(value, timeZone);
  const representedAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return representedAsUtc - Math.trunc(value.getTime() / 1000) * 1000;
}

export function bankLocalDateTimeToIso(input: {
  year: number;
  month: number;
  day: number;
  hour?: number;
  minute?: number;
  second?: number;
  timeZone?: string;
}): string {
  const timeZone = normalizeBankTimeZone(input.timeZone);
  const wallClockUtc = Date.UTC(
    input.year,
    input.month - 1,
    input.day,
    input.hour || 0,
    input.minute || 0,
    input.second || 0,
  );
  let instantMs = wallClockUtc - timeZoneOffsetMs(new Date(wallClockUtc), timeZone);
  instantMs = wallClockUtc - timeZoneOffsetMs(new Date(instantMs), timeZone);
  return new Date(instantMs).toISOString();
}

export function calendarBucketInTimeZone(
  value: string,
  timeZone = DEFAULT_BANK_TIME_ZONE,
  includeMinute = false,
): string {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) throw new Error("INVALID_BANK_TIMESTAMP");
  const parts = dateTimeParts(timestamp, normalizeBankTimeZone(timeZone));
  const pad = (part: number) => String(part).padStart(2, "0");
  const day = `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
  return includeMinute ? `${day}T${pad(parts.hour)}:${pad(parts.minute)}` : day;
}

function addCalendarDays(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

export function utcRangeForCalendarDates(
  startDate: string,
  endDate: string,
  timeZone: string,
): { startIso: string; endExclusiveIso: string } {
  const zone = normalizeBankTimeZone(timeZone);
  const toStartIso = (dateKey: string) => {
    const [year, month, day] = dateKey.split("-").map(Number);
    return bankLocalDateTimeToIso({ year, month, day, timeZone: zone });
  };
  return {
    startIso: toStartIso(startDate),
    endExclusiveIso: toStartIso(addCalendarDays(endDate, 1)),
  };
}
