import { zonedParts, zonedToUtc } from "@/lib/schedule/time";

export type Window = { days: number[]; startMin: number; endMin: number };

export const MIN_GAP_MS = 3 * 60 * 60 * 1000; // ≥ 3 hours between posts on the same account
const STEP_MIN = 30;

/**
 * Next free slot inside the platform's posting window (spec §15): walk forward in 30-minute
 * steps from now, skip the past and anything within 3 h of another item on the same account.
 * The window's end is exclusive of starting a post after it.
 */
export function suggestSlot(opts: { window: Window | null; tz: string; now: Date; taken: Date[]; horizonDays?: number }): Date | null {
  const { window, tz, now, taken } = opts;
  if (!window || !window.days.length || window.endMin <= window.startMin) return null;
  const horizon = opts.horizonDays ?? 28;
  const today = zonedParts(now, tz);
  for (let dayOffset = 0; dayOffset <= horizon; dayOffset++) {
    const base = new Date(Date.UTC(today.y, today.m - 1, today.d + dayOffset));
    const y = base.getUTCFullYear();
    const m = base.getUTCMonth() + 1;
    const d = base.getUTCDate();
    const weekday = (base.getUTCDay() + 6) % 7; // JS Sunday=0 → Monday=0
    if (!window.days.includes(weekday)) continue;
    const first = Math.ceil(window.startMin / STEP_MIN) * STEP_MIN;
    for (let min = first; min < window.endMin; min += STEP_MIN) {
      const at = zonedToUtc(y, m, d, Math.floor(min / 60), min % 60, tz);
      if (at.getTime() <= now.getTime()) continue;
      if (taken.some((t) => Math.abs(t.getTime() - at.getTime()) < MIN_GAP_MS)) continue;
      return at;
    }
  }
  return null;
}

/** Suggest for several drafts at once so they respect each other too. */
export function suggestMany(
  items: { id: string; platform: string }[],
  opts: { windows: Record<string, Window | undefined>; tz: string; now: Date; takenByPlatform: Record<string, Date[]> },
): Record<string, Date | null> {
  const taken: Record<string, Date[]> = Object.fromEntries(Object.entries(opts.takenByPlatform).map(([k, v]) => [k, [...v]]));
  const out: Record<string, Date | null> = {};
  for (const it of items) {
    const list = (taken[it.platform] ??= []);
    const slot = suggestSlot({ window: opts.windows[it.platform] ?? null, tz: opts.tz, now: opts.now, taken: list });
    out[it.id] = slot;
    if (slot) list.push(slot);
  }
  return out;
}

/** Lead time → when the reminder fires. -1 means "the morning of" (08:00 local). */
export function reminderTime(runAt: Date, leadMinutes: number, tz: string): Date {
  if (leadMinutes === -1) {
    const p = zonedParts(runAt, tz);
    const morning = zonedToUtc(p.y, p.m, p.d, 8, 0, tz);
    return morning.getTime() < runAt.getTime() ? morning : new Date(runAt.getTime() - 15 * 60_000);
  }
  return new Date(runAt.getTime() - leadMinutes * 60_000);
}
