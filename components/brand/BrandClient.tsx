"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, Button, Card, cx, Field, inputCls, inputMutedCls, PageHeader, Segmented, Swatch, useToast } from "@/components/ui";
import { IconClose } from "@/components/icons";
import { contrastRatio, isDark, VERDICT_COLOR } from "@/lib/contrast";
import type { Brand, BrandColor } from "@/lib/brand";

const POS = [
  ["tl", "Top left"],
  ["tr", "Top right"],
  ["bl", "Bottom left"],
  ["br", "Bottom right"],
] as const;
const FMT = { p: [1080, 1350, "1080 × 1350 · 4:5 portrait"], s: [1080, 1080, "1080 × 1080 · square"], l: [1200, 627, "1200 × 627 · landscape"] } as const;
const LOGO_PCT = { S: 0.06, M: 0.09, L: 0.12 };
const SIG_PCT = { S: 0.025, M: 0.035, L: 0.045 };

type Editable = Omit<Brand, "logos" | "customFonts">;

const uid = () => Math.random().toString(36).slice(2, 9);
const verdictLevel = (r: number) => (r >= 4.5 ? "pass" : r >= 3 ? "large" : "fail");

export function BrandClient({ initial }: { initial: Brand }) {
  const router = useRouter();
  const toast = useToast();
  const [b, setB] = useState<Editable>(() => {
    const { logos: _l, customFonts: _c, ...rest } = initial;
    return rest;
  });
  const [logos, setLogos] = useState(initial.logos);
  const [fonts, setFonts] = useState(initial.customFonts);
  const [saved, setSaved] = useState(true);
  const [saving, setSaving] = useState(false);
  const [bgIdx, setBgIdx] = useState(Math.max(0, initial.backgrounds.findIndex((c) => c.isDefault)));
  const [fgIdx, setFgIdx] = useState(() => {
    const bg = initial.backgrounds[0]?.hex ?? "#1B1A17";
    let best = 0;
    initial.textColors.forEach((c, i) => {
      if (contrastRatio(bg, c.hex) > contrastRatio(bg, initial.textColors[best].hex)) best = i;
    });
    return best;
  });
  const [fmt, setFmt] = useState<keyof typeof FMT>("p");
  const [real, setReal] = useState<{ url: string; warnings: string[] } | null>(null);
  const [rendering, setRendering] = useState(false);
  const [banned, setBanned] = useState(initial.bannedPhrases.join(", "));
  const fileRef = useRef<HTMLInputElement>(null);
  const fontRef = useRef<HTMLInputElement>(null);
  const [uploadKind, setUploadKind] = useState<string>("");
  const [fontFamily, setFontFamily] = useState("");
  const [fontWeight, setFontWeight] = useState("500");

  const set = (p: Partial<Editable>) => {
    setB((x) => ({ ...x, ...p }));
    setSaved(false);
    setReal(null);
  };

  const bg = b.backgrounds[Math.min(bgIdx, b.backgrounds.length - 1)] ?? { hex: "#1B1A17", name: "", id: "" };
  const fg = b.textColors[Math.min(fgIdx, b.textColors.length - 1)] ?? { hex: "#F4F1EA", name: "", id: "" };

  async function save() {
    setSaving(true);
    try {
      const bannedPhrases = banned
        .split(/[,\n]/)
        .map((s) => s.trim())
        .filter(Boolean);
      await api("/api/brand", { method: "PUT", json: { ...b, bannedPhrases } });
      setSaved(true);
      toast("Brand kit saved", "ok");
      router.refresh();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setSaving(false);
    }
  }

  async function uploadFile(kind: string, f: File) {
    const fd = new FormData();
    fd.append("kind", kind);
    fd.append("file", f);
    if (kind === "font") {
      fd.append("family", fontFamily);
      fd.append("weight", fontWeight);
    }
    try {
      const res = await fetch("/api/brand/upload", { method: "POST", body: fd });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Upload failed");
      if (kind === "font") {
        setFonts((xs) => [...xs.filter((x) => x.family !== j.family || (x.weight ?? 500) !== +fontWeight), { family: j.family, url: j.url, weight: +fontWeight }]);
        setFontFamily("");
        toast(`${j.family} uploaded`, "ok");
      } else {
        const key = kind === "logoPrimary" ? "primary" : kind === "logoReverse" ? "reverse" : "icon";
        setLogos((l) => ({ ...l, [key]: j.url }));
      }
      setReal(null);
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  async function removeLogo(kind: string) {
    await api(`/api/brand/upload?kind=${kind}`, { method: "DELETE" });
    const key = kind === "logoPrimary" ? "primary" : kind === "logoReverse" ? "reverse" : "icon";
    setLogos((l) => ({ ...l, [key]: null }));
  }

  async function removeFont(family: string) {
    await api(`/api/brand/upload?kind=font&family=${encodeURIComponent(family)}`, { method: "DELETE" });
    setFonts((xs) => xs.filter((f) => f.family !== family));
    router.refresh();
  }

  async function renderReal() {
    setRendering(true);
    try {
      const [w, h] = FMT[fmt];
      const r = await api<{ dataUrl: string; warnings: string[] }>("/api/brand/preview", { method: "POST", json: { brand: b, w, h, bgHex: bg.hex, bg2Hex: bg.hex2 ?? null, fgHex: fg.hex } });
      setReal({ url: r.dataUrl, warnings: r.warnings });
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setRendering(false);
    }
  }

  const updateColor = (list: "backgrounds" | "textColors", i: number, p: Partial<BrandColor>) => {
    const next = b[list].map((c, n) => (n === i ? { ...c, ...p } : c));
    set({ [list]: next } as Partial<Editable>);
  };
  const removeColor = (list: "backgrounds" | "textColors", i: number) => {
    if (b[list].length <= 1) return;
    set({ [list]: b[list].filter((_, n) => n !== i) } as Partial<Editable>);
    if (list === "backgrounds") setBgIdx(0);
    else setFgIdx(0);
  };

  // Live preview geometry (HTML approximation of the renderer; "Render" shows the real PNG).
  const [fw, fh, fnote] = FMT[fmt];
  const k = 376 / Math.max(fw, fh);
  const w = Math.round(fw * k);
  const h = Math.round(fh * k);
  const pad = Math.round(Math.min(w, h) * 0.08);
  const logoW = Math.round(w * LOGO_PCT[b.logoSize]);
  const sigPx = Math.max(7, Math.round(h * SIG_PCT[b.sigSize]));
  const dark = isDark(bg.hex);
  const logoUrl = dark && b.autoReverse ? logos.reverse ?? logos.primary : logos.primary ?? logos.reverse ?? logos.icon;
  const logoTop = b.logoPosition.startsWith("t");
  const logoLeft = b.logoPosition.endsWith("l");
  const sigTop = b.sigPlacement === "top";
  const sigAlign = b.sigPlacement === "center" ? "center" : logoLeft ? "flex-end" : "flex-start";
  const logoEl = logoUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={logoUrl} alt="" style={{ width: logoW, height: "auto" }} />
  ) : (
    <span className="rounded-[3px] border-[1.5px] font-semibold tracking-[0.1em]" style={{ fontSize: Math.max(8, logoW * 0.22), padding: `${Math.round(logoW * 0.1)}px ${Math.round(logoW * 0.18)}px`, color: fg.hex, borderColor: fg.hex }}>
      LOGO
    </span>
  );
  const sigEl = <span style={{ fontSize: sigPx, color: fg.hex, opacity: 0.92, whiteSpace: "nowrap" }}>{b.sigCompany || "[YOUR SIGNATURE]"}</span>;
  const fontsList = useMemo(() => ["Fraunces", "IBM Plex Sans", ...new Set(fonts.map((f) => f.family))], [fonts]);

  const logoSlots = [
    { kind: "logoPrimary", name: "Primary logo", sub: "For light backgrounds", bg: "#FFFFFF", fg: "#1B1A17", url: logos.primary },
    { kind: "logoReverse", name: "Reverse logo", sub: "For dark backgrounds", bg: "#1B1A17", fg: "#F4F1EA", url: logos.reverse },
    { kind: "logoIcon", name: "Icon mark", sub: "Small spaces and avatars", bg: "#F4F1EA", fg: "#A8461F", url: logos.icon },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Brand kit"
        title="Every image, unmistakably yours."
        intro="Logo, signature line and colours set here are applied to every generated image. Each platform's image prompt can turn them on or off."
        actions={
          <Button variant="primary" className="px-[22px]" onClick={save} busy={saving} disabled={saved && !saving}>
            {saved ? "Saved" : "Save brand kit"}
          </Button>
        }
      />

      <div className="flex items-start gap-6">
        <div className="flex min-w-0 flex-1 flex-col gap-5">
          <Card aria-label="Logo" className="flex flex-col gap-4 p-6">
            <h2 className="m-0 font-display text-[22px] font-medium">Logo</h2>
            <div className="grid grid-cols-3 gap-3">
              {logoSlots.map((l) => (
                <div key={l.kind} className="flex flex-col gap-2">
                  <div className="flex h-24 items-center justify-center rounded-xl border border-dashed border-dash" style={{ background: l.bg }}>
                    {l.url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={l.url} alt={`${l.name}`} className="max-h-16 max-w-[80%] object-contain" />
                    ) : (
                      <span className="rounded-[3px] border-[1.5px] px-[9px] py-[5px] text-[11px] font-semibold tracking-[0.1em]" style={{ color: l.fg, borderColor: l.fg }}>
                        LOGO
                      </span>
                    )}
                  </div>
                  <span className="text-[13.5px] font-medium">{l.name}</span>
                  <span className="text-xs leading-snug text-caption">{l.sub}</span>
                  <div className="flex gap-1.5">
                    <Button
                      size="sm"
                      className="flex-1"
                      onClick={() => {
                        setUploadKind(l.kind);
                        fileRef.current?.click();
                      }}
                    >
                      {l.url ? "Replace" : "Upload PNG or SVG"}
                    </Button>
                    {l.url ? (
                      <Button size="sm" variant="danger" aria-label={`Remove ${l.name}`} onClick={() => removeLogo(l.kind)}>
                        <IconClose />
                      </Button>
                    ) : null}
                  </div>
                </div>
              ))}
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/svg+xml"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f && uploadKind) uploadFile(uploadKind, f);
                  e.target.value = "";
                }}
              />
            </div>
            <span className="text-xs text-caption">Transparent PNG or SVG, up to 5 MB. SVGs are sanitised on upload.</span>
            <div className="flex flex-wrap items-start gap-7 pt-1">
              <div className="flex flex-col gap-2">
                <span className="text-[13px] font-semibold">Default position</span>
                <div className="grid w-[200px] grid-cols-2 gap-1.5">
                  {POS.map(([v, label]) => (
                    <button
                      key={v}
                      type="button"
                      aria-pressed={b.logoPosition === v}
                      onClick={() => set({ logoPosition: v })}
                      className={cx("min-h-11 cursor-pointer rounded-[9px] border text-[12.5px] text-ink", b.logoPosition === v ? "border-accent bg-accent-soft" : "border-input bg-surface")}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <span className="text-[13px] font-semibold">Size</span>
                <Segmented label="Logo size" value={b.logoSize} onChange={(v) => set({ logoSize: v })} options={(["S", "M", "L"] as const).map((z) => ({ value: z, label: z }))} className="w-[150px]" />
                <span className="text-xs text-caption">{Math.round(LOGO_PCT[b.logoSize] * 100)}% of image width</span>
              </div>
              <label className="mt-6 flex min-h-11 cursor-pointer items-center gap-2.5 text-[13.5px]">
                <input type="checkbox" checked={b.autoReverse} onChange={(e) => set({ autoReverse: e.target.checked })} className="h-[18px] w-[18px] accent-accent" />
                Use the reverse logo on dark backgrounds
              </label>
            </div>
          </Card>

          <Card aria-label="Signature line" className="flex flex-col gap-4 p-6">
            <h2 className="m-0 font-display text-[22px] font-medium">Signature line</h2>
            <div className="grid grid-cols-2 gap-3.5">
              <Field label="Company signature" hint="Facebook, Instagram, LinkedIn Company">
                {(id) => <input id={id} className={inputMutedCls} value={b.sigCompany} onChange={(e) => set({ sigCompany: e.target.value })} />}
              </Field>
              <Field label="Personal signature" hint="LinkedIn Profile, Medium">
                {(id) => <input id={id} className={inputMutedCls} value={b.sigPersonal} onChange={(e) => set({ sigPersonal: e.target.value })} />}
              </Field>
              <Field label="Placement">
                {(id) => (
                  <select id={id} className={inputCls} value={b.sigPlacement} onChange={(e) => set({ sigPlacement: e.target.value as Brand["sigPlacement"] })}>
                    <option value="opposite">Bottom, opposite the logo</option>
                    <option value="center">Bottom centre</option>
                    <option value="top">Top, opposite the logo</option>
                  </select>
                )}
              </Field>
              <Field label="Text size">
                {(id) => (
                  <select id={id} className={inputCls} value={b.sigSize} onChange={(e) => set({ sigSize: e.target.value as Brand["sigSize"] })}>
                    <option value="S">Small · 2.5% of image height</option>
                    <option value="M">Medium · 3.5%</option>
                    <option value="L">Large · 4.5%</option>
                  </select>
                )}
              </Field>
            </div>
          </Card>

          <div className="grid grid-cols-2 gap-5">
            <Card aria-label="Background colours" className="flex flex-col gap-3 p-6">
              <h2 className="m-0 font-display text-[22px] font-medium">Background colours</h2>
              {b.backgrounds.map((c, i) => (
                <div key={c.id} className="flex items-center gap-2.5">
                  <Swatch hex={c.hex} hex2={c.hex2} on={i === bgIdx} onClick={() => setBgIdx(i)} label={`Preview with ${c.name}`} />
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div className="flex items-center gap-1.5">
                      <label className="sr-only" htmlFor={`bgn-${c.id}`}>
                        Name
                      </label>
                      <input id={`bgn-${c.id}`} className="min-h-8 w-24 rounded-md border border-transparent bg-transparent px-1 text-sm font-medium hover:border-input" value={c.name} onChange={(e) => updateColor("backgrounds", i, { name: e.target.value })} />
                      {c.isDefault ? (
                        <span className="rounded-xl bg-success-soft px-2 py-0.5 text-[11px] text-success-text">Default</span>
                      ) : (
                        <button type="button" onClick={() => set({ backgrounds: b.backgrounds.map((x, n) => ({ ...x, isDefault: n === i })) })} className="min-h-7 cursor-pointer border-0 bg-transparent text-[11.5px] text-accent">
                          Make default
                        </button>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <label className="sr-only" htmlFor={`bgh-${c.id}`}>
                        Hex
                      </label>
                      <input id={`bgh-${c.id}`} type="color" value={c.hex} onChange={(e) => updateColor("backgrounds", i, { hex: e.target.value.toUpperCase() })} className="h-7 w-8 cursor-pointer border-0 bg-transparent p-0" />
                      <span className="font-mono text-[12.5px] text-muted">{c.hex}</span>
                      {c.hex2 ? (
                        <>
                          <span className="text-caption">→</span>
                          <input aria-label="Gradient end" type="color" value={c.hex2} onChange={(e) => updateColor("backgrounds", i, { hex2: e.target.value.toUpperCase() })} className="h-7 w-8 cursor-pointer border-0 bg-transparent p-0" />
                          <span className="font-mono text-[12.5px] text-muted">{c.hex2}</span>
                        </>
                      ) : null}
                    </div>
                  </div>
                  {i === bgIdx ? <span className="rounded-xl bg-success-soft px-2.5 py-1 text-xs text-success-text">In preview</span> : null}
                  <button type="button" aria-label={`Remove ${c.name}`} disabled={b.backgrounds.length <= 1} onClick={() => removeColor("backgrounds", i)} className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg border-0 bg-transparent text-caption hover:text-danger-text">
                    <IconClose />
                  </button>
                </div>
              ))}
              <div className="flex gap-2">
                <Button variant="dashed" className="flex-1" onClick={() => set({ backgrounds: [...b.backgrounds, { id: uid(), name: "New", hex: "#2E6B47" }] })}>
                  + Add colour
                </Button>
                <Button variant="dashed" className="flex-1" onClick={() => set({ backgrounds: [...b.backgrounds, { id: uid(), name: "Gradient", hex: "#A8461F", hex2: "#1B1A17" }] })}>
                  + Add gradient
                </Button>
              </div>
            </Card>

            <Card aria-label="Text colours" className="flex flex-col gap-3 p-6">
              <h2 className="m-0 font-display text-[22px] font-medium">Text colours</h2>
              {b.textColors.map((c, i) => {
                const r = Math.min(contrastRatio(bg.hex, c.hex), bg.hex2 ? contrastRatio(bg.hex2, c.hex) : Infinity);
                return (
                  <div key={c.id} className="flex items-center gap-2.5">
                    <Swatch hex={c.hex} on={i === fgIdx} onClick={() => setFgIdx(i)} label={`Preview with ${c.name} text`} />
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <label className="sr-only" htmlFor={`fgn-${c.id}`}>
                        Name
                      </label>
                      <input id={`fgn-${c.id}`} className="min-h-8 w-28 rounded-md border border-transparent bg-transparent px-1 text-sm font-medium hover:border-input" value={c.name} onChange={(e) => updateColor("textColors", i, { name: e.target.value })} />
                      <div className="flex items-center gap-1.5">
                        <input aria-label={`${c.name} hex`} type="color" value={c.hex} onChange={(e) => updateColor("textColors", i, { hex: e.target.value.toUpperCase() })} className="h-7 w-8 cursor-pointer border-0 bg-transparent p-0" />
                        <span className="font-mono text-[12.5px] text-muted">{c.hex}</span>
                      </div>
                    </div>
                    <span className="font-mono text-xs" style={{ color: VERDICT_COLOR[verdictLevel(r)] }}>
                      {r.toFixed(1)}:1
                    </span>
                    <button type="button" aria-label={`Remove ${c.name}`} disabled={b.textColors.length <= 1} onClick={() => removeColor("textColors", i)} className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg border-0 bg-transparent text-caption hover:text-danger-text">
                      <IconClose />
                    </button>
                  </div>
                );
              })}
              <Button variant="dashed" onClick={() => set({ textColors: [...b.textColors, { id: uid(), name: "New", hex: "#FFFFFF" }] })}>
                + Add text colour
              </Button>
              <span className="text-xs leading-snug text-caption">Contrast is measured against the background in the preview. The agent never pairs colours below 4.5:1 for body-size text (3:1 for large text), and falls back to your best-contrast colour if a platform&apos;s pair fails.</span>
            </Card>
          </div>

          <Card aria-label="Typography" className="flex flex-col gap-4 p-6">
            <div className="flex flex-wrap items-end gap-3.5">
              <h2 className="m-0 mb-2.5 mr-3 font-display text-[22px] font-medium">Type</h2>
              <Field label="Headline font" className="min-w-[180px] flex-1">
                {(id) => (
                  <select id={id} className={inputCls} value={b.headlineFont} onChange={(e) => set({ headlineFont: e.target.value })}>
                    {fontsList.map((f) => (
                      <option key={f}>{f}</option>
                    ))}
                  </select>
                )}
              </Field>
              <Field label="Body font" className="min-w-[180px] flex-1">
                {(id) => (
                  <select id={id} className={inputCls} value={b.bodyFont} onChange={(e) => set({ bodyFont: e.target.value })}>
                    {fontsList.map((f) => (
                      <option key={f}>{f}</option>
                    ))}
                  </select>
                )}
              </Field>
            </div>
            <div className="flex flex-wrap items-end gap-2.5 rounded-xl bg-bg p-3.5">
              <Field label="Upload brand font · family name" className="min-w-[200px] flex-1">
                {(id) => <input id={id} className={inputCls} value={fontFamily} onChange={(e) => setFontFamily(e.target.value)} placeholder="e.g. Acme Sans" />}
              </Field>
              <Field label="Weight" className="w-28">
                {(id) => (
                  <select id={id} className={inputCls} value={fontWeight} onChange={(e) => setFontWeight(e.target.value)}>
                    <option value="400">400</option>
                    <option value="500">500</option>
                    <option value="600">600</option>
                    <option value="700">700</option>
                  </select>
                )}
              </Field>
              <Button disabled={!fontFamily.trim()} onClick={() => fontRef.current?.click()}>
                Choose TTF / OTF / WOFF2
              </Button>
              <input
                ref={fontRef}
                type="file"
                accept=".ttf,.otf,.woff,.woff2"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) uploadFile("font", f);
                  e.target.value = "";
                }}
              />
            </div>
            {fonts.length ? (
              <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
                {fonts.map((f) => (
                  <li key={`${f.family}-${f.weight}`} className="inline-flex min-h-8 items-center gap-1.5 rounded-2xl border border-line bg-surface pl-3 pr-1 text-[12.5px]">
                    {f.family} · {f.weight ?? 500}
                    <button type="button" aria-label={`Remove ${f.family}`} onClick={() => removeFont(f.family)} className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent text-muted">
                      <IconClose />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </Card>

          <Card aria-label="Banned phrases" className="flex flex-col gap-3 p-6">
            <h2 className="m-0 font-display text-[22px] font-medium">Banned phrases</h2>
            <Field label="Never use these words in drafts" hint="Comma or line separated. Drafts that use them fail validation and get one automatic repair.">
              {(id) => (
                <textarea
                  id={id}
                  rows={3}
                  value={banned}
                  onChange={(e) => {
                    setBanned(e.target.value);
                    setSaved(false);
                  }}
                  className="w-full resize-y rounded-[10px] border border-input bg-surface-muted p-3 text-[13.5px]"
                />
              )}
            </Field>
          </Card>
        </div>

        <aside aria-label="Preview" className="sticky top-6 flex w-[420px] shrink-0 flex-col gap-3.5 rounded-[16px] bg-side p-[22px]">
          {fonts.length ? (
            <style>{fonts.map((f) => `@font-face{font-family:${JSON.stringify(f.family)};src:url(${JSON.stringify(f.url)});font-weight:${f.weight ?? 500};font-display:swap}`).join("\n")}</style>
          ) : null}
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase tracking-[0.06em] text-side-caption">Live preview</span>
            <Segmented
              dark
              label="Preview format"
              value={fmt}
              onChange={(v) => {
                setFmt(v);
                setReal(null);
              }}
              options={[
                { value: "p", label: "4:5" },
                { value: "s", label: "1:1" },
                { value: "l", label: "1.91:1" },
              ]}
            />
          </div>
          <div className="flex h-[440px] items-center justify-center">
            {real ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={real.url} alt="Rendered preview" style={{ width: w, height: h }} className="rounded" />
            ) : (
              <div
                className="box-border flex flex-col justify-between gap-2.5 overflow-hidden rounded"
                style={{ width: w, height: h, padding: pad, background: bg.hex2 ? `linear-gradient(135deg, ${bg.hex}, ${bg.hex2})` : bg.hex, fontFamily: b.bodyFont }}
              >
                <div className="flex items-center" style={{ justifyContent: logoTop ? (logoLeft ? "space-between" : "space-between") : "space-between", flexDirection: logoLeft ? "row" : "row-reverse" }}>
                  {logoTop ? logoEl : <span />}
                  {sigTop ? sigEl : <span />}
                </div>
                <span className="font-medium leading-[1.12]" style={{ fontFamily: `'${b.headlineFont}', Georgia, serif`, fontSize: fmt === "l" ? 22 : 30, color: fg.hex }}>
                  Your headline sits here, set in your brand type
                </span>
                <div className="flex items-end gap-2" style={{ justifyContent: b.sigPlacement === "center" ? "center" : "space-between", flexDirection: logoLeft ? "row" : "row-reverse" }}>
                  {!logoTop ? logoEl : b.sigPlacement === "center" ? null : <span />}
                  {!sigTop ? <div style={{ display: "flex", justifyContent: sigAlign }}>{sigEl}</div> : null}
                </div>
              </div>
            )}
          </div>
          <span className="text-center font-mono text-[12.5px] text-side-text">{fnote}</span>
          <Button variant="secondary" size="sm" onClick={renderReal} busy={rendering} className="!border-side-active !bg-side-card !text-bg">
            {real ? "Re-render with the real template" : "Render with the real template"}
          </Button>
          {real?.warnings.length ? <span className="text-xs leading-snug text-[#F2C9A8]">{real.warnings.join(" ")}</span> : null}
        </aside>
      </div>
    </>
  );
}
