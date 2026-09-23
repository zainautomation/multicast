"use client";

import { createContext, useCallback, useContext, useId, useState, type ButtonHTMLAttributes, type ReactNode } from "react";

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

type Variant = "primary" | "dark" | "secondary" | "dashed" | "link" | "linkMuted" | "danger" | "success";
const VARIANT: Record<Variant, string> = {
  primary: "bg-accent text-white font-semibold border-0 hover:bg-accent-hover",
  dark: "bg-ink text-white font-semibold border border-ink hover:bg-ink-soft",
  secondary: "bg-surface text-ink border border-input hover:bg-surface-muted",
  dashed: "bg-transparent text-muted border border-dashed border-dash hover:bg-surface",
  link: "bg-transparent text-accent border-0 !px-0 font-medium hover:text-accent-hover",
  linkMuted: "bg-transparent text-muted border-0 !px-0 hover:text-ink",
  danger: "bg-surface text-danger-text border border-input hover:bg-surface-muted",
  success: "bg-success text-white font-semibold border border-success",
};

export function Button({
  variant = "secondary",
  size = "md",
  className,
  busy,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" | "lg"; busy?: boolean }) {
  const sz = size === "sm" ? "min-h-10 px-3 text-[13px] rounded-[9px]" : size === "lg" ? "min-h-[52px] px-5 text-[15.5px] rounded-xl" : "min-h-11 px-4 text-sm rounded-[10px]";
  return (
    <button
      type="button"
      {...rest}
      disabled={rest.disabled || busy}
      aria-busy={busy || undefined}
      className={cx("inline-flex cursor-pointer items-center justify-center gap-2 whitespace-nowrap transition-colors", sz, VARIANT[variant], className)}
    >
      {busy ? <Spinner /> : null}
      {children}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cx("h-4 w-4 animate-spin", className)} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Card({ className, children, as: As = "section", ...rest }: { className?: string; children: ReactNode; as?: "section" | "article" | "div" | "aside"; "aria-label"?: string }) {
  return (
    <As {...rest} className={cx("rounded-[16px] border border-line bg-surface", className)}>
      {children}
    </As>
  );
}

export function PageHeader({ eyebrow, title, intro, actions }: { eyebrow: string; title: string; intro?: string; actions?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-6">
      <div className="flex flex-col gap-1.5">
        <span className="text-[13px] uppercase tracking-[0.06em] text-caption">{eyebrow}</span>
        <h1 className="m-0 font-display text-[38px] font-medium leading-tight tracking-[-0.01em]">{title}</h1>
        {intro ? <p className="m-0 max-w-[720px] text-[15px] leading-normal text-muted">{intro}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2.5">{actions}</div> : null}
    </header>
  );
}

export function Monogram({ mono, color, size = 30, radius }: { mono: string; color: string; size?: number; radius?: number }) {
  return (
    <span
      aria-hidden="true"
      className="flex shrink-0 items-center justify-center font-semibold text-white"
      style={{ width: size, height: size, borderRadius: radius ?? Math.round(size * 0.27), background: color, fontSize: Math.max(11, Math.round(size * 0.38)) }}
    >
      {mono}
    </span>
  );
}

type PillKind = "ok" | "warn" | "none" | "solid" | "danger";
export function Pill({ kind = "none", children }: { kind?: PillKind; children: ReactNode }) {
  const k = {
    ok: "bg-success-soft text-success-text",
    warn: "bg-warn-soft text-warn-text",
    none: "bg-bg text-muted",
    solid: "bg-success text-white",
    danger: "bg-[#FBE4E1] text-danger-text",
  }[kind];
  return <span className={cx("whitespace-nowrap rounded-[14px] px-3 py-[5px] text-[12.5px] font-medium", k)}>{children}</span>;
}

export const inputCls =
  "min-h-11 w-full rounded-[10px] border border-input bg-surface px-3 text-sm text-ink placeholder:text-caption disabled:opacity-60";
export const inputMutedCls = inputCls.replace("bg-surface", "bg-surface-muted");

export function Field({ label, hint, children, id, className, labelClass }: { label: ReactNode; hint?: ReactNode; children: (id: string) => ReactNode; id?: string; className?: string; labelClass?: string }) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <div className={cx("flex flex-col gap-1.5", className)}>
      <label htmlFor={fid} className={cx("text-[13px] font-semibold", labelClass)}>
        {label}
      </label>
      {children(fid)}
      {hint ? <span className="text-[12.5px] leading-snug text-caption">{hint}</span> : null}
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  dark,
  compact,
  className,
}: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (v: T) => void;
  label: string;
  dark?: boolean;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div role="group" aria-label={label} className={cx("flex gap-[3px] rounded-[10px] p-[3px]", dark ? "bg-side-card" : "bg-bg", className)}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o.value)}
            className={cx(
              "min-h-[34px] flex-1 cursor-pointer whitespace-nowrap rounded-[7px] border-0",
              compact ? "px-1.5 text-[12.5px]" : "px-3 text-[13px]",
              on ? (dark ? "bg-bg font-semibold text-ink" : "bg-surface font-semibold text-ink shadow-[0_1px_2px_rgba(27,26,23,0.12)]") : dark ? "bg-transparent text-side-text" : "bg-transparent text-muted",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Swatch({ hex, hex2, on, onClick, label }: { hex: string; hex2?: string | null; on: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={on}
      onClick={onClick}
      className="h-11 w-11 shrink-0 cursor-pointer rounded-[10px] p-0"
      style={{
        background: hex2 ? `linear-gradient(135deg, ${hex}, ${hex2})` : hex,
        border: on ? "3px solid #A8461F" : "1px solid #D6D0C3",
        boxShadow: on ? "inset 0 0 0 2px #FFFFFF" : "none",
      }}
    />
  );
}

// ─── Toasts ─────────────────────────────────────────────────────────────
type Toast = { id: number; text: string; kind: "ok" | "error" | "info" };
const ToastCtx = createContext<(text: string, kind?: Toast["kind"]) => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((text: string, kind: Toast["kind"] = "info") => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x, { id, text, kind }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), kind === "error" ? 8000 : 4000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed bottom-5 right-5 z-50 flex max-w-[420px] flex-col gap-2">
        {items.map((t) => (
          <div
            key={t.id}
            role={t.kind === "error" ? "alert" : "status"}
            className={cx(
              "pointer-events-auto rounded-xl border px-4 py-3 text-[13.5px] leading-snug shadow-[0_6px_24px_rgba(27,26,23,0.12)]",
              t.kind === "error" ? "border-[#F0C8C2] bg-[#FDF3F1] text-danger-text" : t.kind === "ok" ? "border-success-line bg-success-soft text-success-text" : "border-line bg-surface text-ink",
            )}
          >
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);

// ─── fetch helper ───────────────────────────────────────────────────────
export async function api<T = unknown>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const res = await fetch(url, {
    ...rest,
    headers: { ...(json !== undefined ? { "Content-Type": "application/json" } : {}), ...(rest.headers ?? {}) },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data as T;
}
