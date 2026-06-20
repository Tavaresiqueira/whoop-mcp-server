const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function todayIsoDate(): string {
  return new Date().toLocaleDateString("en-CA");
}

export function parseWhoopDate(value: string | undefined): Date {
  const date = value ?? todayIsoDate();
  if (!DATE_PATTERN.test(date)) {
    throw new Error(`Expected date in YYYY-MM-DD format, received "${date}".`);
  }

  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid date "${date}".`);
  }

  return parsed;
}

export function toIsoDate(date: Date): string {
  return date.toLocaleDateString("en-CA");
}

export function addDays(date: Date, days: number): Date {
  const shifted = new Date(date);
  shifted.setDate(shifted.getDate() + days);
  return shifted;
}

export function dateRangeEndingOn(endDate: Date, days: number): Date[] {
  if (!Number.isInteger(days) || days <= 0) {
    throw new Error(`Expected a positive integer day count, received "${days}".`);
  }

  return Array.from({ length: days }, (_, index) => addDays(endDate, index - (days - 1)));
}

export function dayBounds(date: Date): { start: string; end: string } {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);

  const end = addDays(start, 1);
  return {
    start: start.toISOString(),
    end: end.toISOString(),
  };
}

export function millisToHours(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return Math.round((value / 3_600_000) * 10) / 10;
}
