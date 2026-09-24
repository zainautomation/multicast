"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, Button, Card, cx, Field, inputCls, Monogram, PageHeader, Segmented, useToast } from "@/components/ui";
import { IconChevron, IconClose } from "@/components/icons";
import { DAY_SHORT, hhmm, windowLabel, zonedParts, zonedToUtc } from "@/lib/schedule/time";

export type Row = {
  draftId: string;
  briefId: string;
  platform: string;
  name: string;
  short: string;
  mono: string;
  color: string;
  what: string;
  snippet: string;
  canAuto: boolean;
  forcedReason: string | null;
  suggestion: string | null;
  item: { id: string; runAtUtc: string; mode: string; status: string; lastError: string | null } | null;
};

export type CalItem = {
  id: string;
  draftId: string;
  briefId: string;
  platform: string;
  short: string;
  color: string;
  runAtUtc: string;
  mode: string;
  status: string;
  externalUrl: string | null;
  lastError: string | null;
  snippet: string;
};

type WindowRow = { platform: string; name: string; mono: string; color: string; days: number[]; startMin: number; endMin: number };
type Pref = { leadMinutes: number; slack: boolean; email: boolean; browser: boolean };

const TIMES = Array.from({ length: 48 }, (_, i) => hhmm(i * 30));
const HOUR_PX = 48;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// ─── date helpers in the owner's zone ───────────────────────────────────
type DayKey = string; // YYYY-MM-DD
const keyOf = (d: Date, tz: string): DayKey => {
  const p = zonedParts(d, tz);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
};
const parseKey = (k: DayKey) => k.split("-").map(Number) as [number, number, number];
const addDays = (k: DayKey, n: number): DayKey => {
  const [y, m, d] = parseKey(k);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
};
const weekdayOf = (k: DayKey) => {
  const [y, m, d] = parseKey(k);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
};
const dayLabel = (k: DayKey, withMonth = true) => {
  const [, m, d] = parseKey(k);
  return `${DAY_SHORT[weekdayOf(k)]} ${d}${withMonth ? ` ${MONTHS[m - 1]}` : ""}`;
};
const toUtc = (k: DayKey, time: string, tz: string) => {
  const [y, m, d] = parseKey(k);
  const [h, min] = time.split(":").map(Number);
  return zonedToUtc(y, m, d, h, min, tz);
};
const timeOf = (d: Date, tz: string) => {
  const p = zonedParts(d, tz);
  return hhmm(p.h * 60 + (p.min >= 30 ? 30 : 0));
};
const exactTime = (d: Date, tz: string) => {
  const p = zonedParts(d, tz);
  return hhmm(p.h * 60 + p.min);
};

function allZones(): string[] {
  try {
    return (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf("timeZone");
  } catch {
    return ["UTC", "Europe/London", "America/New_York", "America/Los_Angeles", "Asia/Dubai", "Asia/Singapore"];
  }
}

function urlB64ToUint8(base64: string) {
  const pad = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export function ScheduleClient({
  tz: savedTz,
  rows,
  items,
  windows: initialWindows,
  pref: initialPref,
  channels,
  scheduler,
  intent,
}: {
  tz: string | null;
  rows: Row[];
  items: CalItem[];
  windows: WindowRow[];
  pref: Pref;
  channels: { slack: boolean; email: boolean; push: boolean; vapidKey: string | null };
  scheduler: boolean;
  intent: { posted: string | null; retry: string | null; open: string | null };
}) {
  const router = useRouter();
  const toast = useToast();
  const browserTz = typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "UTC";
  const [tz, setTz] = useState(savedTz ?? browserTz);
  const [edits, setEdits] = useState<Record<string, { date?: DayKey; time?: string; mode?: "auto" | "remind" }>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [view, setView] = useState<"week" | "month" | "list">("week");
  const [offset, setOffset] = useState(0);
  const [dialog, setDialog] = useState<{ id: string; focus?: "posted" | "retry" } | null>(null);
  const [windows, setWindows] = useState(initialWindows);
  const [editingWin, setEditingWin] = useState<WindowRow | null>(null);
  const [pref, setPref] = useState(initialPref);
  const zones = useMemo(allZones, []);

  // Store the auto-detected zone the first time.
  useEffect(() => {
    if (!savedTz && browserTz) api("/api/workspace", { method: "PUT", json: { timezone: browserTz } }).catch(() => undefined);
  }, [savedTz, browserTz]);

  useEffect(() => {
    const id = intent.posted ?? intent.retry ?? intent.open;
    if (id) setDialog({ id, focus: intent.posted ? "posted" : intent.retry ? "retry" : undefined });
  }, [intent.posted, intent.retry, intent.open]);

  const today = keyOf(new Date(), tz);
  const dateOptions = useMemo(() => Array.from({ length: 42 }, (_, i) => addDays(today, i)), [today]);

  const rowState = (r: Row) => {
    const e = edits[r.draftId] ?? {};
    const base = r.item ? new Date(r.item.runAtUtc) : r.suggestion ? new Date(r.suggestion) : toUtc(addDays(today, 1), "09:00", tz);
    const mode = (e.mode ?? (r.item?.mode as "auto" | "remind" | undefined) ?? (r.canAuto ? "auto" : "remind")) as "auto" | "remind";
    return { date: e.date ?? keyOf(base, tz), time: e.time ?? exactTime(base, tz), mode: r.canAuto ? mode : "remind", dirty: !!(e.date || e.time || e.mode) };
  };
  const setRow = (id: string, p: { date?: DayKey; time?: string; mode?: "auto" | "remind" }) => setEdits((x) => ({ ...x, [id]: { ...x[id], ...p } }));

  const scheduledCount = rows.filter((r) => r.item && ["pending", "sent", "published"].includes(r.item.status)).length;

  async function changeTz(next: string) {
    setTz(next);
    setEdits({});
    try {
      await api("/api/workspace", { method: "PUT", json: { timezone: next } });
      router.refresh();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  async function scheduleRows(list: Row[]) {
    if (!list.length) return;
    const payload = list.map((r) => {
      const s = rowState(r);
      return { draftId: r.draftId, runAtUtc: toUtc(s.date, s.time, tz).toISOString(), mode: s.mode };
    });
    setBusy(list.length > 1 ? "all" : list[0].draftId);
    try {
      const res = await api<{ results: { draftId: string; ok: boolean; error?: string }[] }>("/api/schedule", { method: "POST", json: { items: payload } });
      const bad = res.results.filter((x) => !x.ok);
      const good = res.results.filter((x) => x.ok);
      if (good.length) toast(`${good.length} post${good.length === 1 ? "" : "s"} scheduled`, "ok");
      for (const b of bad) toast(`${rows.find((r) => r.draftId === b.draftId)?.name}: ${b.error}`, "error");
      setEdits((x) => {
        const n = { ...x };
        for (const g of good) delete n[g.draftId];
        return n;
      });
      router.refresh();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(null);
    }
  }

  async function unscheduleItem(itemId: string, label?: string) {
    if (!confirm(`Unschedule ${label ?? "this post"}? It goes back to Ready to schedule.`)) return;
    setBusy(itemId);
    try {
      await api(`/api/schedule/${itemId}`, { method: "DELETE" });
      router.refresh();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(null);
    }
  }

  async function moveItem(itemId: string, at: Date) {
    if (at.getTime() < Date.now()) {
      toast("That time is in the past", "error");
      return;
    }
    try {
      await api(`/api/schedule/${itemId}`, { method: "PATCH", json: { runAtUtc: at.toISOString() } });
      toast(`Moved to ${dayLabel(keyOf(at, tz))} · ${exactTime(at, tz)}`, "ok");
      router.refresh();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  function useAllSuggested() {
    const n: typeof edits = { ...edits };
    for (const r of rows) {
      if (r.item || !r.suggestion) continue;
      const d = new Date(r.suggestion);
      n[r.draftId] = { ...n[r.draftId], date: keyOf(d, tz), time: timeOf(d, tz) };
    }
    setEdits(n);
  }

  async function savePref(p: Partial<Pref>) {
    const next = { ...pref, ...p };
    setPref(next);
    try {
      await api("/api/notifications", { method: "PUT", json: p });
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  async function toggleBrowser(on: boolean) {
    if (!on) return savePref({ browser: false });
    if (!channels.push || !channels.vapidKey) {
      toast("Browser notifications need VAPID keys on the server (see README).", "error");
      return;
    }
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") throw new Error("Notifications are blocked for this site in your browser settings");
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8(channels.vapidKey) }));
      await api("/api/push", { method: "POST", json: sub.toJSON() });
      await savePref({ browser: true });
      toast("Browser notifications on for this device", "ok");
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  async function saveWindow(w: WindowRow) {
    try {
      await api(`/api/windows/${w.platform}`, { method: "PUT", json: { days: w.days, startMin: w.startMin, endMin: w.endMin } });
      setWindows((ws) => ws.map((x) => (x.platform === w.platform ? w : x)));
      setEditingWin(null);
      router.refresh();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  // ─── calendar data ─────────────────────────────────────────────────────
  const weekStart = addDays(today, -weekdayOf(today) + offset * 7);
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const byDay = useMemo(() => {
    const m: Record<DayKey, CalItem[]> = {};
    for (const it of items) {
      if (it.status === "cancelled") continue;
      (m[keyOf(new Date(it.runAtUtc), tz)] ??= []).push(it);
    }
    return m;
  }, [items, tz]);
  const weekItems = weekDays.flatMap((d) => byDay[d] ?? []);
  const mins = weekItems.map((i) => {
    const p = zonedParts(new Date(i.runAtUtc), tz);
    return p.h * 60 + p.min;
  });
  const startHour = Math.min(8, ...mins.map((m) => Math.floor(m / 60)));
  const endHour = Math.max(20, ...mins.map((m) => Math.ceil((m + 60) / 60)));
  const hours = Array.from({ length: endHour - startHour }, (_, i) => startHour + i);
  const [ty, tm] = parseKey(today);
  const monthRef = new Date(Date.UTC(ty, tm - 1 + offset, 1));
  const monthFirst = `${monthRef.getUTCFullYear()}-${String(monthRef.getUTCMonth() + 1).padStart(2, "0")}-01`;
  const monthGridStart = addDays(monthFirst, -weekdayOf(monthFirst));
  const title =
    view === "month"
      ? `${MONTHS[monthRef.getUTCMonth()]} ${monthRef.getUTCFullYear()}`
      : view === "week"
        ? (() => {
            const [, m1, d1] = parseKey(weekDays[0]);
            const [y2, m2, d2] = parseKey(weekDays[6]);
            return `${d1} ${MONTHS[m1 - 1]} – ${d2} ${MONTHS[m2 - 1]} ${y2}`;
          })()
        : "All scheduled posts";

  const evStyle = (it: CalItem): React.CSSProperties => {
    const auto = it.mode === "auto";
    const failed = it.status === "failed";
    return auto
      ? { background: failed ? "#FFFFFF" : it.color, color: failed ? "#9B2C1F" : "#FFFFFF", border: failed ? "1.5px solid #B42318" : "none", opacity: it.status === "published" ? 0.8 : 1 }
      : { background: "#FFFFFF", color: failed ? "#9B2C1F" : it.color, border: `1.5px dashed ${failed ? "#B42318" : it.color}`, opacity: it.status === "published" ? 0.8 : 1 };
  };
  const statusText = (it: CalItem) =>
    it.status === "published" ? "Posted" : it.status === "failed" ? "Failed" : it.status === "sent" ? "Reminder sent" : it.mode === "auto" ? "Auto-publish" : "Reminder";

  const dialogItem = dialog ? items.find((i) => i.id === dialog.id) ?? null : null;

  return (
    <>
      <PageHeader
        eyebrow="Schedule"
        title="Know exactly when each post goes out."
        actions={
          <>
            <label htmlFor="tz" className="text-[13px] text-muted">
              Time zone
            </label>
            <select id="tz" className={inputCls + " !w-auto max-w-[260px]"} value={tz} onChange={(e) => changeTz(e.target.value)}>
              {!zones.includes(tz) ? <option value={tz}>{tz}</option> : null}
              {zones.map((z) => (
                <option key={z} value={z}>
                  {z === browserTz ? `${z} · this browser` : z}
                </option>
              ))}
            </select>
          </>
        }
      />

      {!scheduler ? (
        <div className="rounded-xl border border-[#F0D9BE] bg-warn-soft px-4 py-3 text-[14px] text-warn-text">
          Scheduling isn&apos;t set up yet. On Vercel, connect Upstash QStash (adds <code className="font-mono">QSTASH_TOKEN</code>); self-hosted, set <code className="font-mono">REDIS_URL</code> and run <code className="font-mono">npm run worker</code>. Post now on Compose works without it.
        </div>
      ) : null}

      <Card aria-label="Ready to schedule" className="flex flex-col overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-divider px-[22px] py-[18px]">
          <div className="flex flex-col gap-0.5">
            <h2 className="m-0 font-display text-[22px] font-medium">Ready to schedule</h2>
            <span className="text-[13px] text-caption">
              {scheduledCount} of {rows.length} approved draft{rows.length === 1 ? "" : "s"} scheduled
            </span>
          </div>
          <div className="flex gap-2.5">
            <Button onClick={useAllSuggested} disabled={!rows.some((r) => !r.item && r.suggestion)}>
              Use suggested times for all
            </Button>
            <Button variant="primary" busy={busy === "all"} disabled={!rows.some((r) => !r.item) || !scheduler} onClick={() => scheduleRows(rows.filter((r) => !r.item))}>
              Schedule all
            </Button>
          </div>
        </div>
        {!rows.length ? (
          <div className="px-[22px] py-10 text-center text-[14.5px] text-muted">
            Nothing approved yet. Approve drafts on <Link href="/compose">Compose</Link> and they appear here.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-[200px_minmax(0,1fr)_150px_110px_190px_120px] gap-3.5 bg-surface-muted px-[22px] py-2.5 text-xs uppercase tracking-[0.04em] text-caption">
              <span>Platform</span>
              <span>Content</span>
              <span>Date</span>
              <span>Time</span>
              <span>When it&apos;s time</span>
              <span />
            </div>
            {rows.map((r) => {
              const s = rowState(r);
              const scheduled = !!r.item && ["pending", "sent"].includes(r.item.status);
              const failed = r.item?.status === "failed";
              const sug = r.suggestion ? new Date(r.suggestion) : null;
              return (
                <div key={r.draftId} className="grid grid-cols-[200px_minmax(0,1fr)_150px_110px_190px_120px] items-center gap-3.5 border-t border-divider px-[22px] py-3">
                  <div className="flex items-center gap-2.5">
                    <Monogram mono={r.mono} color={r.color} size={30} radius={8} />
                    <div className="flex flex-col gap-px">
                      <span className="text-sm font-semibold">{r.name}</span>
                      <span className="text-xs text-caption">{r.what}</span>
                    </div>
                  </div>
                  <div className="flex min-w-0 flex-col gap-1">
                    <Link href={`/compose?brief=${r.briefId}`} className="truncate text-[13px] !text-ink-soft no-underline hover:underline">
                      {r.snippet}
                    </Link>
                    {failed ? (
                      <span className="text-xs text-danger-text">Failed: {r.item?.lastError}</span>
                    ) : !scheduled && sug ? (
                      <button type="button" onClick={() => setRow(r.draftId, { date: keyOf(sug, tz), time: timeOf(sug, tz) })} className="min-h-7 cursor-pointer self-start rounded-[14px] border border-line bg-bg px-2.5 text-xs text-muted hover:border-input">
                        Suggested: {dayLabel(keyOf(sug, tz), false)} · {exactTime(sug, tz)}
                      </button>
                    ) : !scheduled ? (
                      <span className="text-xs text-caption">No free slot in this platform&apos;s window · pick a time</span>
                    ) : null}
                  </div>
                  <div>
                    <label htmlFor={`d-${r.draftId}`} className="sr-only">
                      Date for {r.name}
                    </label>
                    <select id={`d-${r.draftId}`} value={s.date} onChange={(e) => setRow(r.draftId, { date: e.target.value })} className="min-h-10 w-full rounded-[9px] border border-input bg-surface px-2 text-[13px] text-ink">
                      {!dateOptions.includes(s.date) ? <option value={s.date}>{dayLabel(s.date)}</option> : null}
                      {dateOptions.map((k) => (
                        <option key={k} value={k}>
                          {dayLabel(k)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor={`t-${r.draftId}`} className="sr-only">
                      Time for {r.name}
                    </label>
                    <select id={`t-${r.draftId}`} value={s.time} onChange={(e) => setRow(r.draftId, { time: e.target.value })} className="min-h-10 w-full rounded-[9px] border border-input bg-surface px-2 font-mono text-[13px] text-ink">
                      {!TIMES.includes(s.time) ? <option value={s.time}>{s.time}</option> : null}
                      {TIMES.map((t) => (
                        <option key={t}>{t}</option>
                      ))}
                    </select>
                  </div>
                  <div title={r.forcedReason ?? undefined}>
                    <Segmented
                      compact
                      label={`When it's time for ${r.name}`}
                      value={s.mode}
                      onChange={(v) => (r.canAuto || v === "remind" ? setRow(r.draftId, { mode: v }) : toast(r.forcedReason ?? "Remind me only", "error"))}
                      options={[
                        { value: "auto", label: <span className={cx(!r.canAuto && "opacity-50")}>Auto-publish</span> },
                        { value: "remind", label: "Remind me" },
                      ]}
                    />
                  </div>
                  {scheduled && !s.dirty ? (
                    <Button size="sm" className="!border-success !bg-success-soft font-semibold !text-success-text" busy={busy === r.item!.id} onClick={() => unscheduleItem(r.item!.id, r.name)} title="Click to unschedule">
                      Scheduled
                    </Button>
                  ) : (
                    <Button size="sm" variant="dark" busy={busy === r.draftId} disabled={!scheduler} onClick={() => scheduleRows([r])}>
                      {scheduled || failed ? (failed ? "Reschedule" : "Update") : "Schedule"}
                    </Button>
                  )}
                </div>
              );
            })}
          </>
        )}
      </Card>

      <Card aria-label="Calendar" className="flex flex-col gap-3.5 px-[22px] py-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            {view !== "list" ? (
              <button type="button" aria-label={`Previous ${view}`} onClick={() => setOffset((x) => x - 1)} className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-[9px] border border-input bg-surface text-ink">
                <IconChevron dir="left" />
              </button>
            ) : null}
            <h2 className="m-0 font-display text-[22px] font-medium">{title}</h2>
            {view !== "list" ? (
              <button type="button" aria-label={`Next ${view}`} onClick={() => setOffset((x) => x + 1)} className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-[9px] border border-input bg-surface text-ink">
                <IconChevron dir="right" />
              </button>
            ) : null}
            {offset !== 0 && view !== "list" ? (
              <Button variant="linkMuted" size="sm" onClick={() => setOffset(0)}>
                Today
              </Button>
            ) : null}
          </div>
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1.5 text-[12.5px] text-muted">
              <span className="h-3 w-3 rounded-[3px] bg-ink" />
              Auto-publish
            </span>
            <span className="flex items-center gap-1.5 text-[12.5px] text-muted">
              <span className="box-border h-3 w-3 rounded-[3px] border-[1.5px] border-dashed border-ink" />
              Reminder
            </span>
            <Segmented
              label="Calendar view"
              value={view}
              onChange={(v) => {
                setView(v);
                setOffset(0);
              }}
              options={[
                { value: "week", label: "Week" },
                { value: "month", label: "Month" },
                { value: "list", label: "List" },
              ]}
            />
          </div>
        </div>

        {view === "week" ? (
          <>
            <div className="grid grid-cols-[56px_repeat(7,minmax(0,1fr))]">
              <span />
              {weekDays.map((d) => {
                const n = (byDay[d] ?? []).length;
                return (
                  <div key={d} className={cx("border-l border-divider px-2.5 py-2 text-[13px] font-semibold", d === today && "text-accent")}>
                    {dayLabel(d, false)} <span className="font-normal text-caption">· {n ? `${n} post${n === 1 ? "" : "s"}` : "—"}</span>
                  </div>
                );
              })}
            </div>
            <div className="grid grid-cols-[56px_repeat(7,minmax(0,1fr))] border-t border-divider">
              <div>
                {hours.map((h) => (
                  <div key={h} className="h-12 -translate-y-[7px] pr-2 text-right font-mono text-[11px] text-caption">
                    {hhmm(h * 60)}
                  </div>
                ))}
              </div>
              {weekDays.map((d) => (
                <div
                  key={d}
                  className={cx("relative border-l border-divider", d === today && "bg-accent-soft/40")}
                  style={{ height: hours.length * HOUR_PX, backgroundImage: "linear-gradient(#EEEAE1 1px, transparent 1px)", backgroundSize: `100% ${HOUR_PX}px` }}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const id = e.dataTransfer.getData("text/plain");
                    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
                    const y = e.clientY - rect.top - Number(e.dataTransfer.getData("offsetY") || 0);
                    const minutes = Math.max(0, Math.min(23 * 60 + 30, startHour * 60 + Math.round(((y / HOUR_PX) * 60) / 30) * 30));
                    if (id) moveItem(id, toUtc(d, hhmm(minutes), tz));
                  }}
                >
                  {(byDay[d] ?? []).map((it) => {
                    const at = new Date(it.runAtUtc);
                    const p = zonedParts(at, tz);
                    const top = ((p.h * 60 + p.min - startHour * 60) / 60) * HOUR_PX + 2;
                    const draggable = it.status === "pending" || it.status === "failed";
                    return (
                      <button
                        key={it.id}
                        type="button"
                        draggable={draggable}
                        onDragStart={(e) => {
                          e.dataTransfer.setData("text/plain", it.id);
                          e.dataTransfer.setData("offsetY", String(e.clientY - (e.currentTarget as HTMLElement).getBoundingClientRect().top));
                        }}
                        onClick={() => setDialog({ id: it.id })}
                        aria-label={`${it.short} at ${exactTime(at, tz)}, ${statusText(it)}. Open details`}
                        className={cx("absolute left-1 right-1 box-border flex h-16 flex-col gap-px overflow-hidden rounded-lg px-2 py-1.5 text-left", draggable ? "cursor-grab" : "cursor-pointer")}
                        style={{ top, ...evStyle(it) }}
                      >
                        <span className="font-mono text-[11px]">{exactTime(at, tz)}</span>
                        <span className="truncate text-xs font-semibold">{it.short}</span>
                        <span className="text-[11px] opacity-90">{statusText(it)}</span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
            <span className="text-xs text-caption">Drag a post to reschedule it (30-minute steps), or click it for details.</span>
          </>
        ) : view === "month" ? (
          <div className="grid grid-cols-7 border-l border-t border-divider">
            {DAY_SHORT.map((d) => (
              <div key={d} className="border-b border-r border-divider px-2 py-1.5 text-xs font-semibold text-caption">
                {d}
              </div>
            ))}
            {Array.from({ length: 42 }, (_, i) => addDays(monthGridStart, i)).map((d) => {
              const list = byDay[d] ?? [];
              const inMonth = d.slice(0, 7) === monthFirst.slice(0, 7);
              return (
                <div key={d} className={cx("flex min-h-[104px] flex-col gap-1 border-b border-r border-divider p-1.5", !inMonth && "bg-surface-muted", d === today && "bg-accent-soft")}>
                  <span className={cx("text-xs", inMonth ? "text-ink" : "text-caption", d === today && "font-semibold text-accent")}>{parseKey(d)[2]}</span>
                  {list.slice(0, 3).map((it) => (
                    <button key={it.id} type="button" onClick={() => setDialog({ id: it.id })} className="flex cursor-pointer items-center gap-1 truncate rounded px-1.5 py-0.5 text-left text-[11px]" style={evStyle(it)}>
                      <span className="font-mono">{exactTime(new Date(it.runAtUtc), tz)}</span> {it.short}
                    </button>
                  ))}
                  {list.length > 3 ? <span className="text-[11px] text-caption">+{list.length - 3} more</span> : null}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex flex-col">
            {!items.length ? <span className="py-6 text-center text-sm text-muted">No scheduled posts yet.</span> : null}
            {items
              .filter((i) => i.status !== "cancelled")
              .map((it) => {
                const at = new Date(it.runAtUtc);
                return (
                  <button key={it.id} type="button" onClick={() => setDialog({ id: it.id })} className="flex cursor-pointer items-center gap-3.5 border-0 border-t border-solid border-divider bg-transparent px-1 py-3 text-left hover:bg-surface-muted">
                    <span className="h-3 w-3 shrink-0 rounded-[3px]" style={it.mode === "auto" ? { background: it.color } : { border: `1.5px dashed ${it.color}` }} />
                    <span className="w-44 font-mono text-[12.5px]">
                      {dayLabel(keyOf(at, tz))} · {exactTime(at, tz)}
                    </span>
                    <span className="w-36 text-[13.5px] font-semibold">{it.short}</span>
                    <span className="min-w-0 flex-1 truncate text-[13px] text-ink-soft">{it.snippet}</span>
                    <span className={cx("text-xs", it.status === "failed" ? "text-danger-text" : it.status === "published" ? "text-success-text" : "text-caption")}>{statusText(it)}</span>
                  </button>
                );
              })}
          </div>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Card aria-label="Posting windows" className="flex flex-col gap-2.5 p-[22px]">
          <div className="flex items-baseline justify-between">
            <h2 className="m-0 font-display text-xl font-medium">Posting windows</h2>
            <span className="text-[12.5px] text-caption">Your defaults · drive the suggestions</span>
          </div>
          {windows.map((w) => (
            <div key={w.platform} className="flex flex-col gap-2 border-t border-divider py-2">
              <div className="flex items-center gap-3">
                <Monogram mono={w.mono} color={w.color} size={26} radius={7} />
                <span className="w-[150px] text-[13.5px] font-medium">{w.name}</span>
                <span className="flex-1 font-mono text-[12.5px] text-ink-soft">{windowLabel(w.days, w.startMin, w.endMin)}</span>
                <Button size="sm" className="!min-h-[34px]" aria-expanded={editingWin?.platform === w.platform} onClick={() => setEditingWin(editingWin?.platform === w.platform ? null : { ...w })}>
                  Edit
                </Button>
              </div>
              {editingWin?.platform === w.platform ? (
                <div className="ml-[38px] flex flex-col gap-2.5 rounded-xl bg-bg p-3">
                  <div className="flex flex-wrap gap-1.5" role="group" aria-label="Days">
                    {DAY_SHORT.map((d, i) => {
                      const on = editingWin.days.includes(i);
                      return (
                        <button
                          key={d}
                          type="button"
                          aria-pressed={on}
                          onClick={() => setEditingWin({ ...editingWin, days: on ? editingWin.days.filter((x) => x !== i) : [...editingWin.days, i] })}
                          className={cx("min-h-9 min-w-[46px] cursor-pointer rounded-lg border text-[12.5px]", on ? "border-accent bg-accent-soft text-ink" : "border-input bg-surface text-muted")}
                        >
                          {d}
                        </button>
                      );
                    })}
                  </div>
                  <div className="flex flex-wrap items-end gap-2">
                    <Field label="From" className="w-28">
                      {(id) => (
                        <select id={id} className={inputCls + " font-mono"} value={hhmm(editingWin.startMin)} onChange={(e) => setEditingWin({ ...editingWin, startMin: TIMES.indexOf(e.target.value) * 30 })}>
                          {TIMES.map((t) => (
                            <option key={t}>{t}</option>
                          ))}
                        </select>
                      )}
                    </Field>
                    <Field label="To" className="w-28">
                      {(id) => (
                        <select id={id} className={inputCls + " font-mono"} value={hhmm(editingWin.endMin)} onChange={(e) => setEditingWin({ ...editingWin, endMin: TIMES.indexOf(e.target.value) * 30 })}>
                          {TIMES.map((t) => (
                            <option key={t}>{t}</option>
                          ))}
                        </select>
                      )}
                    </Field>
                    <Button variant="dark" size="sm" className="!min-h-11" disabled={editingWin.endMin <= editingWin.startMin} onClick={() => saveWindow(editingWin)}>
                      Save window
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          ))}
          <span className="text-xs leading-snug text-caption">The agent also keeps at least 3 hours between posts on the same account.</span>
        </Card>

        <Card aria-label="Reminders" className="flex flex-col gap-3.5 p-[22px]">
          <h2 className="m-0 font-display text-xl font-medium">Reminders</h2>
          <Field label="Remind me before each post" hint="Applies to posts you schedule from now on.">
            {(id) => (
              <select id={id} className={inputCls} value={pref.leadMinutes} onChange={(e) => savePref({ leadMinutes: Number(e.target.value) })}>
                <option value={15}>15 minutes before</option>
                <option value={0}>At the scheduled time</option>
                <option value={60}>1 hour before</option>
                <option value={-1}>The morning of</option>
              </select>
            )}
          </Field>
          <fieldset className="m-0 border-0 p-0">
            <legend className="mb-1.5 p-0 text-[13px] font-semibold">Send reminders to</legend>
            <div className="flex flex-wrap gap-[22px]">
              <label className="flex min-h-10 cursor-pointer items-center gap-2 text-[13.5px]" title={channels.slack ? undefined : "Connect Slack in Integrations"}>
                <input type="checkbox" checked={pref.slack} onChange={(e) => savePref({ slack: e.target.checked })} className="h-[18px] w-[18px] accent-accent" />
                Slack{!channels.slack ? <span className="text-xs text-caption">(not connected)</span> : null}
              </label>
              <label className="flex min-h-10 cursor-pointer items-center gap-2 text-[13.5px]" title={channels.email ? undefined : "Set EMAIL_RESEND_API_KEY or SMTP settings on the server"}>
                <input type="checkbox" checked={pref.email} onChange={(e) => savePref({ email: e.target.checked })} className="h-[18px] w-[18px] accent-accent" />
                Email{!channels.email ? <span className="text-xs text-caption">(server not configured)</span> : null}
              </label>
              <label className="flex min-h-10 cursor-pointer items-center gap-2 text-[13.5px]">
                <input type="checkbox" checked={pref.browser} onChange={(e) => toggleBrowser(e.target.checked)} className="h-[18px] w-[18px] accent-accent" />
                Browser notification
              </label>
            </div>
          </fieldset>
          <div className="rounded-[10px] bg-bg px-3.5 py-3 text-[13px] leading-normal text-[#3A3731]">
            Reminders include the final copy, the image download and a direct link to the platform, so a copy-and-paste post like Quora or Medium takes under a minute. Auto-published posts send a confirmation with the live link.
          </div>
          <Link href="/integrations" className="text-[13px]">
            Slack settings
          </Link>
        </Card>
      </div>

      {dialog ? (
        <ItemDialog
          key={dialog.id}
          item={dialogItem}
          focus={dialog.focus}
          tz={tz}
          dateOptions={dateOptions}
          onClose={() => {
            setDialog(null);
            if (intent.posted || intent.retry || intent.open) router.replace("/schedule");
          }}
          onDone={() => {
            setDialog(null);
            router.replace("/schedule");
            router.refresh();
          }}
          onUnschedule={(id) => unscheduleItem(id)}
          onMove={moveItem}
        />
      ) : null}
    </>
  );
}

function ItemDialog({
  item,
  focus,
  tz,
  dateOptions,
  onClose,
  onDone,
  onUnschedule,
  onMove,
}: {
  item: CalItem | null;
  focus?: "posted" | "retry";
  tz: string;
  dateOptions: DayKey[];
  onClose: () => void;
  onDone: () => void;
  onUnschedule: (id: string) => void;
  onMove: (id: string, at: Date) => Promise<void>;
}) {
  const toast = useToast();
  const at = item ? new Date(item.runAtUtc) : new Date();
  const [date, setDate] = useState(keyOf(at, tz));
  const [time, setTime] = useState(timeOf(at, tz));
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function act(key: string, fn: () => Promise<unknown>, ok: string) {
    setBusy(key);
    try {
      await fn();
      toast(ok, "ok");
      onDone();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(null);
    }
  }

  const open = item && (item.status === "pending" || item.status === "failed");
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-[rgba(27,26,23,0.35)] px-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Scheduled post" className="flex w-[520px] max-w-full flex-col gap-4 rounded-[16px] bg-surface p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="m-0 font-display text-[22px] font-medium">{item ? `${item.short} · ${item.mode === "auto" ? "Auto-publish" : "Reminder"}` : "Not found"}</h2>
          <button type="button" aria-label="Close" onClick={onClose} className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-[9px] border border-input bg-surface">
            <IconClose />
          </button>
        </div>
        {!item ? (
          <p className="m-0 text-sm text-muted">This scheduled post no longer exists.</p>
        ) : (
          <>
            <p className="m-0 line-clamp-4 text-[13.5px] leading-normal text-ink-soft">{item.snippet}</p>
            <div className="flex flex-wrap gap-2 text-[13px] text-muted">
              <span>
                {dayLabel(keyOf(at, tz))} · {exactTime(at, tz)}
              </span>
              <span>·</span>
              <span className={item.status === "failed" ? "text-danger-text" : ""}>{item.status === "sent" ? "Reminder sent" : item.status[0].toUpperCase() + item.status.slice(1)}</span>
            </div>
            {item.lastError ? <p className="m-0 rounded-lg bg-[#FDF3F1] px-3 py-2 text-[13px] text-danger">{item.lastError}</p> : null}
            {item.externalUrl ? (
              <a href={item.externalUrl} target="_blank" rel="noreferrer" className="text-[13.5px]">
                View live post ↗
              </a>
            ) : null}

            {open ? (
              <div className="flex flex-wrap items-end gap-2 rounded-xl bg-bg p-3">
                <Field label="Date" className="w-40">
                  {(id) => (
                    <select id={id} className={inputCls} value={date} onChange={(e) => setDate(e.target.value)}>
                      {!dateOptions.includes(date) ? <option value={date}>{dayLabel(date)}</option> : null}
                      {dateOptions.map((k) => (
                        <option key={k} value={k}>
                          {dayLabel(k)}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
                <Field label="Time" className="w-28">
                  {(id) => (
                    <select id={id} className={inputCls + " font-mono"} value={time} onChange={(e) => setTime(e.target.value)}>
                      {!TIMES.includes(time) ? <option>{time}</option> : null}
                      {TIMES.map((t) => (
                        <option key={t}>{t}</option>
                      ))}
                    </select>
                  )}
                </Field>
                <Button variant="dark" className="!min-h-11" busy={busy === "move"} onClick={() => act("move", () => onMove(item.id, toUtc(date, time, tz)), "Rescheduled")}>
                  Move
                </Button>
              </div>
            ) : null}

            {item.mode === "remind" && item.status !== "published" ? (
              <div className="flex flex-col gap-2 rounded-xl border border-line p-3">
                <label htmlFor="posted-url" className="text-[13px] font-semibold">
                  Posted it yourself? Add the live link (optional)
                </label>
                <div className="flex gap-2">
                  <input id="posted-url" autoFocus={focus === "posted"} type="url" className={inputCls} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
                  <Button variant="success" busy={busy === "posted"} onClick={() => act("posted", () => api(`/api/schedule/${item.id}/posted`, { method: "POST", json: { url } }), "Marked as posted")}>
                    Mark as posted
                  </Button>
                </div>
              </div>
            ) : null}

            <div className="flex flex-wrap gap-2 border-t border-divider pt-3">
              {item.status === "failed" ? (
                <Button variant="primary" autoFocus={focus === "retry"} busy={busy === "retry"} onClick={() => act("retry", () => api(`/api/schedule/${item.id}/retry`, { method: "POST" }), "Retrying now")}>
                  Retry
                </Button>
              ) : null}
              {open || item.status === "sent" ? (
                <Button variant="danger" onClick={() => onUnschedule(item.id)}>
                  Unschedule
                </Button>
              ) : null}
              <Link href={`/compose?brief=${item.briefId}`} className="ml-auto inline-flex min-h-11 items-center text-[13.5px]">
                Open the draft
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
