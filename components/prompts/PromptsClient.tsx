"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api, Button, Card, cx, Field, inputCls, Monogram, PageHeader, Swatch, useToast } from "@/components/ui";
import { contrastVerdict, VERDICT_COLOR } from "@/lib/contrast";
import { FORMAT_OPTIONS, IMAGE_VARIABLES, RULE_OPTIONS, STYLE_OPTIONS, TEXT_VARIABLES, type ImageDefaults, type OutputRules } from "@/lib/prompts/defaults";
import type { SizePreset } from "@/lib/platforms";
import type { BrandColor } from "@/lib/brand";

export type LayerView = {
  id: string;
  name: string;
  sub: string;
  mono: string;
  color: string;
  specRows: { k: string; v: string }[];
  pub: string;
  sizes: SizePreset[];
  textPrompt: string;
  imagePrompt: string;
  rules: OutputRules;
  imageDefaults: ImageDefaults;
  enabled: boolean;
  version: number;
};

type Draft = Pick<LayerView, "textPrompt" | "imagePrompt" | "rules" | "imageDefaults" | "enabled">;

function withOption(options: readonly string[], current: string) {
  return options.includes(current) ? [...options] : [current, ...options];
}

export function PromptsClient({
  layers: initial,
  backgrounds,
  textColors,
  generators,
  signatures,
  logoPosition,
}: {
  layers: LayerView[];
  backgrounds: BrandColor[];
  textColors: BrandColor[];
  generators: { id: string; label: string; on: boolean }[];
  signatures: { company: string; personal: string };
  logoPosition: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [layers, setLayers] = useState(initial);
  const [picked, setPicked] = useState("lip");
  const [tab, setTab] = useState<"text" | "image">("text");
  const [edits, setEdits] = useState<Record<string, Partial<Draft>>>({});
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<{ platform: string; output: { title: string | null; body: string; first_comment: string | null }; errors: string[]; notes: string[] } | null>(null);
  const [history, setHistory] = useState<{ current: number; versions: { version: number; createdAt: string; textPrompt: string }[] } | null>(null);
  const [custom, setCustom] = useState<{ w: string; h: string } | null>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const imgRef = useRef<HTMLTextAreaElement>(null);

  const base = layers.find((l) => l.id === picked)!;
  const e = edits[picked] ?? {};
  const cur: Draft = {
    textPrompt: e.textPrompt ?? base.textPrompt,
    imagePrompt: e.imagePrompt ?? base.imagePrompt,
    rules: { ...base.rules, ...(e.rules ?? {}) },
    imageDefaults: { ...base.imageDefaults, ...(e.imageDefaults ?? {}), include: { ...base.imageDefaults.include, ...(e.imageDefaults?.include ?? {}) } },
    enabled: e.enabled ?? base.enabled,
  };
  const dirty = Object.keys(e).length > 0;
  const isPlatform = picked !== "brand";

  const patch = (p: Partial<Draft>) => {
    setSavedAt(null);
    setEdits((x) => ({ ...x, [picked]: { ...x[picked], ...p } }));
  };
  const patchRules = (r: Partial<OutputRules>) => patch({ rules: { ...(e.rules ?? {}), ...r } as OutputRules });
  const patchImg = (d: Partial<ImageDefaults>) => patch({ imageDefaults: { ...(e.imageDefaults ?? {}), ...d } as ImageDefaults });

  function insertVar(v: string, which: "text" | "image") {
    const el = which === "text" ? textRef.current : imgRef.current;
    const value = which === "text" ? cur.textPrompt : cur.imagePrompt;
    const s = el?.selectionStart ?? value.length;
    const en = el?.selectionEnd ?? value.length;
    const next = value.slice(0, s) + v + value.slice(en);
    patch(which === "text" ? { textPrompt: next } : { imagePrompt: next });
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(s + v.length, s + v.length);
    });
  }

  async function save() {
    setSaving(true);
    try {
      const r = await api<{ layer: LayerView }>(`/api/prompts/${picked}`, { method: "PUT", json: e });
      setLayers((ls) => ls.map((l) => (l.id === picked ? { ...l, ...pick(r.layer) } : l)));
      setEdits((x) => ({ ...x, [picked]: {} }));
      setSavedAt(`Saved · version ${r.layer.version}`);
      setHistory(null);
      router.refresh();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setSaving(false);
    }
  }

  async function reset() {
    if (!confirm(`Reset the ${tab === "text" ? "text prompt and output rules" : "image prompt and image settings"} for ${base.name} to the default? The current version stays in history.`)) return;
    const r = await api<{ layer: LayerView }>(`/api/prompts/${picked}/reset`, { method: "POST", json: { tab } });
    setLayers((ls) => ls.map((l) => (l.id === picked ? { ...l, ...pick(r.layer) } : l)));
    setEdits((x) => ({ ...x, [picked]: {} }));
    setSavedAt(`Reset · version ${r.layer.version}`);
  }

  async function runTest() {
    setTesting(true);
    setTest(null);
    try {
      const r = await api<typeof test>(`/api/prompts/${picked}/test`, { method: "POST", json: { textPrompt: cur.textPrompt, rules: isPlatform ? cur.rules : undefined } });
      setTest(r);
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setTesting(false);
    }
  }

  async function loadHistory() {
    setHistory(await api(`/api/prompts/${picked}/history`));
  }

  async function restore(version: number) {
    const r = await api<{ layer: LayerView }>(`/api/prompts/${picked}/history`, { method: "POST", json: { version } });
    setLayers((ls) => ls.map((l) => (l.id === picked ? { ...l, ...pick(r.layer) } : l)));
    setEdits((x) => ({ ...x, [picked]: {} }));
    setHistory(null);
    setSavedAt(`Restored v${version} as version ${r.layer.version}`);
  }

  // Image tab derived values
  const d = cur.imageDefaults;
  const sizes = base.sizes;
  const size = sizes.find((z) => z.key === d.sizeKey) ?? (d.sizeKey.match(/^(\d+)x(\d+)$/) ? { key: d.sizeKey, w: +d.sizeKey.split("x")[0], h: +d.sizeKey.split("x")[1], label: "Custom" } : sizes[0]);
  const verdict = contrastVerdict(d.bgHex, d.fgHex);
  const bgEntry = backgrounds.find((c) => c.hex.toLowerCase() === d.bgHex.toLowerCase());
  const sig = picked === "lip" || picked === "medium" ? signatures.personal : signatures.company;
  const thumb = useMemo(() => {
    if (!size) return { w: 150, h: 150 };
    const k = 150 / Math.max(size.w, size.h);
    return { w: Math.round(size.w * k), h: Math.round(size.h * k) };
  }, [size]);

  return (
    <>
      <PageHeader
        eyebrow="Platform prompts"
        title="Teach each platform how you write."
        intro="Brand voice is sent with every request. Each platform prompt is layered on top, followed by the hard limits in the spec panel, so drafts never exceed what the platform allows."
      />

      <div className="flex min-h-0 flex-1 gap-6">
        <div role="list" aria-label="Prompt layers" className="flex w-[250px] shrink-0 flex-col gap-1.5">
          {layers.map((it) => {
            const on = it.id === picked;
            const hasEdits = Object.keys(edits[it.id] ?? {}).length > 0;
            return (
              <div role="listitem" key={it.id}>
                <button
                  type="button"
                  onClick={() => {
                    setPicked(it.id);
                    setSavedAt(null);
                    setTest(null);
                    setHistory(null);
                    setCustom(null);
                  }}
                  aria-current={on || undefined}
                  className={cx("flex min-h-14 w-full cursor-pointer items-center gap-3 rounded-xl border px-3 py-2 text-left text-ink", on ? "border-accent bg-surface" : "border-transparent bg-transparent hover:bg-surface/60")}
                >
                  <Monogram mono={it.mono} color={it.color} size={28} />
                  <span className="flex min-w-0 flex-col items-start gap-px">
                    <span className="text-sm font-medium">
                      {it.name}
                      {hasEdits ? <span className="ml-1.5 text-accent" aria-label="unsaved changes">•</span> : null}
                    </span>
                    <span className="text-xs text-caption">{it.enabled ? it.sub : "Disabled"}</span>
                  </span>
                </button>
              </div>
            );
          })}
          <button type="button" disabled title="New platforms are added in lib/platforms.ts (TikTok, X, Threads… are planned)" className="mt-2 min-h-11 rounded-[10px] border border-dashed border-dash bg-transparent text-[13.5px] text-muted">
            + Add platform
          </button>
        </div>

        <Card aria-label="Prompt editor" className="flex min-w-0 flex-1 flex-col gap-5 self-start p-[26px]">
          <div className="flex items-center gap-3">
            <Monogram mono={base.mono} color={base.color} size={40} radius={10} />
            <div className="flex flex-1 flex-col">
              <h2 className="m-0 font-display text-2xl font-medium">{base.name}</h2>
              <span className="text-[13px] text-caption">
                {base.sub} · version {base.version}
              </span>
            </div>
            {isPlatform ? (
              <label className="flex min-h-11 cursor-pointer items-center gap-2 text-[13.5px]">
                <input type="checkbox" checked={cur.enabled} onChange={(ev) => patch({ enabled: ev.target.checked })} className="h-[18px] w-[18px] accent-accent" />
                Enabled
              </label>
            ) : null}
          </div>

          <div role="tablist" aria-label="Prompt type" className="flex gap-1 self-start rounded-xl bg-bg p-1">
            {(["text", "image"] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={cx("min-h-10 cursor-pointer rounded-[9px] border-0 px-[18px] text-sm text-ink", tab === t ? "bg-surface font-semibold shadow-[0_1px_2px_rgba(27,26,23,0.12)]" : "bg-transparent")}
              >
                {t === "text" ? "Text prompt" : "Image prompt"}
              </button>
            ))}
          </div>

          {tab === "text" ? (
            <div className="flex flex-col gap-5" role="tabpanel">
              <div className="flex flex-col gap-2">
                <div className="flex items-baseline justify-between">
                  <label htmlFor="sys" className="text-sm font-semibold">
                    System prompt
                  </label>
                  <span className="font-mono text-xs text-caption">{cur.textPrompt.length.toLocaleString()} chars</span>
                </div>
                <textarea
                  id="sys"
                  ref={textRef}
                  rows={11}
                  value={cur.textPrompt}
                  onChange={(ev) => patch({ textPrompt: ev.target.value })}
                  className="w-full resize-y rounded-[10px] border border-input bg-surface-muted px-4 py-3.5 font-mono text-[13px] leading-[1.65] text-ink"
                />
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="mr-1 text-[12.5px] text-caption">Insert variable</span>
                  {[...TEXT_VARIABLES, ...(picked === "reddit" ? ["{subreddit_rules}"] : [])].map((v) => (
                    <button key={v} type="button" onClick={() => insertVar(v, "text")} className="min-h-8 cursor-pointer rounded-md border border-line bg-bg px-2.5 font-mono text-xs text-muted hover:border-input">
                      {v}
                    </button>
                  ))}
                </div>
              </div>

              {isPlatform ? (
                <div className="flex flex-col gap-3">
                  <span className="text-sm font-semibold">Output rules</span>
                  <div className="grid grid-cols-3 gap-3.5">
                    {(
                      [
                        ["length", "Target length", withOption(RULE_OPTIONS.length, cur.rules.length)],
                        ["hashtags", "Hashtags", withOption(RULE_OPTIONS.hashtags, cur.rules.hashtags)],
                        ["emoji", "Emoji", withOption(RULE_OPTIONS.emoji, cur.rules.emoji)],
                        ["voice", "Voice", withOption(RULE_OPTIONS.voice, cur.rules.voice)],
                        ["cta", "Link / CTA", withOption(RULE_OPTIONS.cta, cur.rules.cta)],
                      ] as const
                    ).map(([k, label, opts]) => (
                      <Field key={k} label={label} labelClass="!font-normal text-muted">
                        {(id) => (
                          <select id={id} className={inputCls} value={cur.rules[k] as string} onChange={(ev) => patchRules({ [k]: ev.target.value })}>
                            {opts.map((o) => (
                              <option key={o}>{o}</option>
                            ))}
                          </select>
                        )}
                      </Field>
                    ))}
                    <Field label="Variants per run" labelClass="!font-normal text-muted">
                      {(id) => (
                        <select id={id} className={inputCls} value={cur.rules.variants} onChange={(ev) => patchRules({ variants: +ev.target.value })}>
                          {RULE_OPTIONS.variants.map((o) => (
                            <option key={o} value={o}>
                              {o}
                            </option>
                          ))}
                        </select>
                      )}
                    </Field>
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="flex flex-col gap-5" role="tabpanel">
              <div className="flex items-start gap-[22px]">
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <div className="flex items-baseline justify-between">
                    <label htmlFor="imgp" className="text-sm font-semibold">
                      {isPlatform ? "Image prompt" : "Global image style"}
                    </label>
                    <span className="font-mono text-xs text-caption">{cur.imagePrompt.length.toLocaleString()} chars</span>
                  </div>
                  <textarea
                    id="imgp"
                    ref={imgRef}
                    rows={9}
                    value={cur.imagePrompt}
                    onChange={(ev) => patch({ imagePrompt: ev.target.value })}
                    className="w-full resize-y rounded-[10px] border border-input bg-surface-muted px-4 py-3.5 font-mono text-[13px] leading-[1.65] text-ink"
                  />
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="mr-1 text-[12.5px] text-caption">Insert variable</span>
                    {IMAGE_VARIABLES.map((v) => (
                      <button key={v} type="button" onClick={() => insertVar(v, "image")} className="min-h-8 cursor-pointer rounded-md border border-line bg-bg px-2.5 font-mono text-xs text-muted hover:border-input">
                        {v}
                      </button>
                    ))}
                  </div>
                </div>
                {isPlatform ? (
                  <div className="flex w-[176px] shrink-0 flex-col items-center gap-2">
                    <span className="self-start text-xs uppercase tracking-[0.04em] text-caption">Preview</span>
                    <div className="flex h-[176px] w-[176px] items-center justify-center rounded-xl bg-bg">
                      <div
                        className="box-border flex flex-col justify-between gap-1 overflow-hidden rounded border border-input p-2.5"
                        style={{ width: thumb.w, height: thumb.h, background: bgEntry?.hex2 ? `linear-gradient(135deg, ${d.bgHex}, ${bgEntry.hex2})` : d.bgHex }}
                      >
                        <div className={cx("flex", logoPosition === "tr" ? "justify-end" : "justify-start")}>
                          {d.include.logo && logoPosition.startsWith("t") ? <span className="rounded-sm border px-[5px] py-0.5 text-[7px] font-semibold tracking-[0.08em]" style={{ color: d.fgHex, borderColor: d.fgHex }}>LOGO</span> : null}
                        </div>
                        {d.include.headline ? <span className="font-display text-[13px] font-medium leading-[1.15]" style={{ color: d.fgHex }}>Your headline sits here</span> : <span />}
                        <div className="flex items-end justify-between gap-1">
                          {d.include.logo && logoPosition === "bl" ? <span className="rounded-sm border px-[5px] py-0.5 text-[7px] font-semibold" style={{ color: d.fgHex, borderColor: d.fgHex }}>LOGO</span> : null}
                          {d.include.sig ? <span className="ml-auto truncate text-[7px]" style={{ color: d.fgHex }}>{sig || "[YOUR SIGNATURE LINE]"}</span> : null}
                          {d.include.logo && logoPosition === "br" ? <span className="rounded-sm border px-[5px] py-0.5 text-[7px] font-semibold" style={{ color: d.fgHex, borderColor: d.fgHex }}>LOGO</span> : null}
                        </div>
                      </div>
                    </div>
                    <span className="font-mono text-xs text-muted">
                      {size ? `${size.w} × ${size.h} · ${size.label}` : ""}
                    </span>
                  </div>
                ) : null}
              </div>

              {isPlatform ? (
                <div className="flex flex-col gap-[18px]">
                  <div className="flex flex-col gap-2">
                    <span className="text-sm font-semibold">Default size</span>
                    <div className="flex flex-wrap gap-2">
                      {sizes.map((z) => {
                        const on = z.key === d.sizeKey;
                        return (
                          <button
                            key={z.key}
                            type="button"
                            aria-pressed={on}
                            onClick={() => patchImg({ sizeKey: z.key })}
                            className={cx("flex min-h-[52px] cursor-pointer flex-col items-start justify-center gap-px rounded-[10px] border px-3.5 py-1.5 text-ink", on ? "border-accent bg-accent-soft" : "border-input bg-surface")}
                          >
                            <span className="font-mono text-[13px]">
                              {z.w} × {z.h}
                            </span>
                            <span className="text-xs text-caption">{z.label}</span>
                          </button>
                        );
                      })}
                      {!sizes.some((z) => z.key === d.sizeKey) ? (
                        <span className="flex min-h-[52px] flex-col justify-center rounded-[10px] border border-accent bg-accent-soft px-3.5 font-mono text-[13px]">{d.sizeKey.replace("x", " × ")} · Custom</span>
                      ) : null}
                      {custom ? (
                        <div className="flex items-center gap-1.5">
                          <label className="sr-only" htmlFor="cw">
                            Width
                          </label>
                          <input id="cw" className={inputCls + " !w-20 font-mono"} inputMode="numeric" value={custom.w} onChange={(ev) => setCustom({ ...custom, w: ev.target.value })} placeholder="W" />
                          <span>×</span>
                          <label className="sr-only" htmlFor="ch">
                            Height
                          </label>
                          <input id="ch" className={inputCls + " !w-20 font-mono"} inputMode="numeric" value={custom.h} onChange={(ev) => setCustom({ ...custom, h: ev.target.value })} placeholder="H" />
                          <Button
                            size="sm"
                            variant="dark"
                            disabled={!(+custom.w >= 200 && +custom.h >= 200 && +custom.w <= 4000 && +custom.h <= 4000)}
                            onClick={() => {
                              patchImg({ sizeKey: `${+custom.w}x${+custom.h}` });
                              setCustom(null);
                            }}
                          >
                            Use
                          </Button>
                        </div>
                      ) : (
                        <Button variant="dashed" className="min-h-[52px]" onClick={() => setCustom({ w: "", h: "" })}>
                          + Custom size
                        </Button>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-[18px]">
                    <div className="flex flex-col gap-2">
                      <span className="text-[13px] font-semibold">Background colour</span>
                      <div className="flex flex-wrap gap-2">
                        {backgrounds.map((c) => (
                          <Swatch key={c.id} hex={c.hex} hex2={c.hex2} on={c.hex.toLowerCase() === d.bgHex.toLowerCase()} onClick={() => patchImg({ bgHex: c.hex })} label={`Background ${c.name}`} />
                        ))}
                      </div>
                    </div>
                    <div className="flex flex-col gap-2">
                      <span className="text-[13px] font-semibold">Text colour</span>
                      <div className="flex flex-wrap items-center gap-2">
                        {textColors.map((c) => (
                          <Swatch key={c.id} hex={c.hex} on={c.hex.toLowerCase() === d.fgHex.toLowerCase()} onClick={() => patchImg({ fgHex: c.hex })} label={`Text ${c.name}`} />
                        ))}
                        <span className="ml-1.5 font-mono text-xs" style={{ color: VERDICT_COLOR[verdict.level] }}>
                          {verdict.label}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-3.5">
                    <Field label="Generator" labelClass="!font-normal text-muted">
                      {(id) => (
                        <select id={id} className={inputCls} value={d.generator} onChange={(ev) => patchImg({ generator: ev.target.value as ImageDefaults["generator"] })}>
                          {generators.map((g) => (
                            <option key={g.id} value={g.id} disabled={!g.on}>
                              {g.label}
                              {g.on ? "" : " · connect first"}
                            </option>
                          ))}
                        </select>
                      )}
                    </Field>
                    <Field label="Visual style" labelClass="!font-normal text-muted">
                      {(id) => (
                        <select id={id} className={inputCls} value={d.style} onChange={(ev) => patchImg({ style: ev.target.value as ImageDefaults["style"] })}>
                          {STYLE_OPTIONS.map((o) => (
                            <option key={o}>{o}</option>
                          ))}
                        </select>
                      )}
                    </Field>
                    <Field label="Format" labelClass="!font-normal text-muted">
                      {(id) => (
                        <select id={id} className={inputCls} value={d.format} onChange={(ev) => patchImg({ format: ev.target.value as ImageDefaults["format"] })}>
                          {FORMAT_OPTIONS.map((o) => (
                            <option key={o}>{o}</option>
                          ))}
                        </select>
                      )}
                    </Field>
                  </div>

                  <fieldset className="m-0 border-0 p-0">
                    <legend className="mb-2 p-0 text-[13px] font-semibold">Include on image</legend>
                    <div className="flex flex-wrap gap-[22px]">
                      {(
                        [
                          ["logo", "Logo"],
                          ["sig", "Signature line"],
                          ["headline", "Headline text"],
                        ] as const
                      ).map(([k, label]) => (
                        <label key={k} className="flex min-h-10 cursor-pointer items-center gap-2 text-[13.5px]">
                          <input
                            type="checkbox"
                            checked={d.include[k]}
                            onChange={(ev) => patchImg({ include: { ...d.include, [k]: ev.target.checked } })}
                            className="h-[18px] w-[18px] accent-accent"
                          />
                          {label}
                        </label>
                      ))}
                      <Link href="/brand" className="ml-auto self-center text-[13px]">
                        Edit logo, signature &amp; colours in Brand kit
                      </Link>
                    </div>
                  </fieldset>
                </div>
              ) : null}
            </div>
          )}

          {test ? (
            <div className="flex flex-col gap-2 rounded-xl border border-line bg-surface-muted p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs uppercase tracking-[0.04em] text-caption">Test output · not saved{picked === "brand" ? ` · via ${test.platform}` : ""}</span>
                <Button variant="linkMuted" size="sm" onClick={() => setTest(null)}>
                  Close
                </Button>
              </div>
              {test.output.title ? <div className="text-[15px] font-semibold">{test.output.title}</div> : null}
              <div className="max-h-[260px] overflow-y-auto whitespace-pre-line text-[13.5px] leading-[1.55] text-ink-soft">{test.output.body}</div>
              {test.output.first_comment ? <div className="text-[12.5px] text-muted">First comment: {test.output.first_comment}</div> : null}
              {test.errors.map((x) => (
                <div key={x} className="text-[12.5px] text-danger">
                  {x}
                </div>
              ))}
              {test.notes.map((x) => (
                <div key={x} className="text-[12.5px] text-warn-text">
                  {x}
                </div>
              ))}
            </div>
          ) : null}

          {history ? (
            <div className="flex flex-col gap-1 rounded-xl border border-line bg-surface-muted p-4">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs uppercase tracking-[0.04em] text-caption">Version history · last 20</span>
                <Button variant="linkMuted" size="sm" onClick={() => setHistory(null)}>
                  Close
                </Button>
              </div>
              {history.versions.map((v) => (
                <div key={v.version} className="flex items-center gap-3 border-t border-divider py-2 text-[13px]">
                  <span className="w-12 font-mono">v{v.version}</span>
                  <span className="w-44 text-caption">{new Date(v.createdAt).toLocaleString()}</span>
                  <span className="min-w-0 flex-1 truncate text-muted">{v.textPrompt.split("\n")[0]}</span>
                  {v.version === history.current ? (
                    <span className="text-xs text-success-text">Current</span>
                  ) : (
                    <Button size="sm" onClick={() => restore(v.version)}>
                      Restore
                    </Button>
                  )}
                </div>
              ))}
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-2.5 border-t border-divider pt-1.5">
            <Button onClick={reset}>Reset to default</Button>
            {tab === "text" ? (
              <Button onClick={runTest} busy={testing}>
                Test with last brief
              </Button>
            ) : null}
            <Button variant="linkMuted" onClick={loadHistory}>
              History
            </Button>
            <span role="status" className="ml-auto text-[13px] text-success-text">
              {savedAt ?? (dirty ? "Unsaved changes" : "")}
            </span>
            <Button variant="primary" className="px-[22px]" onClick={save} busy={saving} disabled={!dirty}>
              {!dirty && savedAt ? "Saved" : "Save prompt"}
            </Button>
          </div>
        </Card>

        <aside aria-label="Platform spec" className="flex w-[290px] shrink-0 flex-col gap-3.5 self-start">
          <div className="flex flex-col gap-3.5 rounded-[16px] bg-side p-[22px] text-bg">
            <span className="text-xs uppercase tracking-[0.06em] text-side-caption">Hard limits · enforced</span>
            {base.specRows.map((sp) => (
              <div key={sp.k} className="flex flex-col gap-[3px] border-b border-side-active pb-3">
                <span className="text-[12.5px] text-side-caption">{sp.k}</span>
                <span className="font-mono text-sm">{sp.v}</span>
              </div>
            ))}
          </div>
          <div className="flex flex-col gap-2 rounded-[16px] border border-line bg-surface px-5 py-[18px]">
            <span className="text-[13px] font-semibold">Publishing</span>
            <span className="text-[13.5px] leading-normal text-muted">{base.pub}</span>
          </div>
        </aside>
      </div>
    </>
  );
}

function pick(l: LayerView): Partial<LayerView> {
  return { textPrompt: l.textPrompt, imagePrompt: l.imagePrompt, rules: l.rules, imageDefaults: l.imageDefaults, enabled: l.enabled, version: l.version };
}
