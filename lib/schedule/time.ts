// Time-zone maths with Intl only. All stored times are UTC; the UI works in the user's zone.

export type ZParts = { y: number; m: number; d: number; h: number; min: number; weekday: number /* 0 = Mon */ };

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short" });
    fmtCache.set(tz, f);
  }
  return f;
}

const WD: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

export function zonedParts(date: Date, tz: string): ZParts {
  const parts = Object.fromEntries(fmt(tz).formatToParts(date).map((p) => [p.type, p.value]));
  return { y: +parts.year, m: +parts.month, d: +parts.day, h: +parts.hour % 24, min: +parts.minute, weekday: WD[parts.weekday] ?? 0 };
}

function offsetMs(date: Date, tz: string): number {
  const p = zonedParts(date, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.min) - Math.floor(date.getTime() / 60000) * 60000;
}

/** Wall-clock time in `tz` → UTC Date (handles DST by re-checking the offset). */
export function zonedToUtc(y: number, m: number, d: number, h: number, min: number, tz: string): Date {
  const guess = Date.UTC(y, m - 1, d, h, min);
  let t = guess - offsetMs(new Date(guess), tz);
  const o2 = offsetMs(new Date(t), tz);
  t = guess - o2;
  return new Date(t);
}

export function isValidTz(tz: string | null | undefined): tz is string {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Local midnight of the day containing `date`, as UTC. */
export function startOfZonedDay(date: Date, tz: string): Date {
  const p = zonedParts(date, tz);
  return zonedToUtc(p.y, p.m, p.d, 0, 0, tz);
}

export function addDaysZoned(date: Date, days: number, tz: string): Date {
  const p = zonedParts(date, tz);
  const base = new Date(Date.UTC(p.y, p.m - 1, p.d + days));
  return zonedToUtc(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate(), p.h, p.min, tz);
}

export function hhmm(minutes: number) {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

export const DAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** "Tue–Thu · 08:30–10:30" */
export function windowLabel(days: number[], startMin: number, endMin: number) {
  const sorted = [...days].sort((a, b) => a - b);
  const contiguous = sorted.every((d, i) => i === 0 || d === sorted[i - 1] + 1);
  const dayPart = !sorted.length ? "No days" : contiguous && sorted.length > 2 ? `${DAY_SHORT[sorted[0]]}–${DAY_SHORT[sorted[sorted.length - 1]]}` : sorted.map((d) => DAY_SHORT[d]).join(", ");
  return `${dayPart} · ${hhmm(startMin)}–${hhmm(endMin)}`;
}
