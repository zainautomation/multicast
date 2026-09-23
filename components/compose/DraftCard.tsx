"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { api, Button, cx, Monogram, Spinner, useToast } from "@/components/ui";
import type { DraftDTO, ImageDTO } from "@/lib/dto";
import type { PlatformTile } from "@/components/compose/ComposeClient";

const BOX = 132;

function Thumb({ img, name }: { img: ImageDTO; name: string }) {
  const [i, setI] = useState(0);
  const w = img.width || 1080;
  const h = img.height || 1080;
  const k = BOX / Math.max(w, h);
  const url = img.urls[Math.min(i, img.urls.length - 1)];
  const isVideo = img.mimeType.startsWith("video/");
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="flex h-[132px] w-[132px] shrink-0 items-center justify-center">
        {img.status === "generating" ? (
          <div className="mc-pulse rounded border border-input bg-divider" style={{ width: Math.round(w * k), height: Math.round(h * k) }} aria-label="Image generating" />
        ) : isVideo ? (
          <video src={url} muted playsInline controls className="rounded border border-input" style={{ width: Math.round(w * k) || BOX, height: Math.round(h * k) || BOX }} />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={`${name} image${img.urls.length > 1 ? `, slide ${i + 1} of ${img.urls.length}` : ""}`} className="rounded border border-input object-cover" style={{ width: Math.round(w * k), height: Math.round(h * k) }} />
        )}
      </div>
      {img.urls.length > 1 ? (
        <div className="flex items-center gap-1 text-[11px] text-muted">
          <button type="button" aria-label="Previous slide" className="min-h-6 min-w-6 cursor-pointer rounded border-0 bg-transparent" onClick={() => setI((x) => (x - 1 + img.urls.length) % img.urls.length)}>
            ‹
          </button>
          <span className="font-mono">
            {i + 1}/{img.urls.length}
          </span>
          <button type="button" aria-label="Next slide" className="min-h-6 min-w-6 cursor-pointer rounded border-0 bg-transparent" onClick={() => setI((x) => (x + 1) % img.urls.length)}>
            ›
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function DraftCard({
  draft: d,
  tile,
  wantsImage,
  heygen,
  onChange,
}: {
  draft: DraftDTO;
  tile: PlatformTile;
  wantsImage: boolean;
  heygen: boolean;
  onChange: (d: DraftDTO) => void;
}) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(d.title ?? "");
  const [body, setBody] = useState(d.body ?? "");
  const [comment, setComment] = useState(d.firstComment ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const generating = d.status === "generating";
  const locked = d.status === "scheduled" || d.status === "published";
  const approved = d.status === "approved";
  const blocked = d.warnings.length > 0;
  const text = editing ? body : d.body ?? "";
  const len = text.length;
  const over = tile.limit > 0 && len > tile.limit;
  const titleOver = !!tile.titleLimit && (editing ? title : d.title ?? "").length > tile.titleLimit;
  const img = d.images[0] ?? null;
  const variants = Array.isArray(d.variants) ? (d.variants as { body: string }[]) : [];

  async function run<T>(key: string, fn: () => Promise<T>) {
    setBusy(key);
    try {
      return await fn();
    } catch (e) {
      toast((e as Error).message, "error");
      return null;
    } finally {
      setBusy(null);
    }
  }

  const call = (key: string, url: string, json?: unknown, method = "POST") =>
    run(key, async () => {
      const r = await api<{ draft: DraftDTO }>(url, { method, json });
      onChange(r.draft);
      return r.draft;
    });

  async function saveEdit() {
    const r = await call("save", `/api/drafts/${d.id}`, { title: tile.titleLabel ? title : undefined, body, firstComment: comment || null }, "PATCH");
    if (r) setEditing(false);
  }

  async function primary() {
    if (tile.copyMode && d.hasPost && !approved) {
      const full = [d.title, d.subtitle, d.body].filter(Boolean).join("\n\n");
      try {
        await navigator.clipboard.writeText(full);
        toast("Copied to clipboard", "ok");
      } catch {
        toast("Could not copy automatically; select the text and copy it", "error");
      }
    }
    await call("approve", `/api/drafts/${d.id}/approve`, { approved: !approved });
  }

  async function upload(f: File) {
    const fd = new FormData();
    fd.append("file", f);
    fd.append("replace", "true");
    await run("upload", async () => {
      const res = await fetch(`/api/drafts/${d.id}/upload`, { method: "POST", body: fd });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Upload failed");
      onChange(j.draft);
    });
  }

  function downloadAll(i: ImageDTO) {
    i.urls.forEach((u, n) => {
      const a = document.createElement("a");
      a.href = u;
      a.download = `${tile.id}-${n + 1}.${i.mimeType === "image/jpeg" ? "jpg" : i.mimeType.startsWith("video/") ? "mp4" : "png"}`;
      a.target = "_blank";
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
    });
  }

  const primaryLabel = !d.hasPost ? (approved ? "Image approved" : "Approve image") : tile.copyMode ? (approved ? "Copied" : "Copy text") : approved ? "Approved" : "Approve";

  return (
    <article className="flex flex-col overflow-hidden rounded-[16px] border border-line bg-surface" aria-busy={generating || undefined}>
      <div className="flex items-center gap-2.5 border-b border-divider px-4 py-3.5">
        <Monogram mono={tile.mono} color={tile.color} size={30} radius={8} />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-sm font-semibold">{tile.name}</span>
          <span className="text-xs text-caption">
            {tile.mode}
            {!tile.auto && !tile.copyMode ? " · connect to auto-post" : ""}
          </span>
        </div>
        <span className={cx("whitespace-nowrap rounded-md bg-bg px-2 py-1 font-mono text-xs", over ? "text-danger" : "text-muted")} aria-label={over ? "Over the character limit" : undefined}>
          {!d.hasPost ? "Image" : tile.limit ? `${len.toLocaleString()} / ${tile.limit.toLocaleString()}` : `${len.toLocaleString()} chars`}
        </span>
      </div>

      {generating ? (
        <div className="flex flex-col gap-2 px-4 py-4" role="status">
          <span className="flex items-center gap-2 text-[13px] text-muted">
            <Spinner /> Writing {d.hasPost ? "the post" : "the image text"}…
          </span>
          <div className="mc-pulse h-3 w-4/5 rounded bg-divider" />
          <div className="mc-pulse h-3 w-3/5 rounded bg-divider" />
          <div className="mc-pulse h-3 w-2/3 rounded bg-divider" />
        </div>
      ) : d.status === "failed" && !d.body && !d.images.length ? (
        <div className="flex flex-col gap-2 px-4 py-4 text-[13px]">
          <span className="text-danger-text">{d.lastError ?? "Generation failed."}</span>
        </div>
      ) : editing ? (
        <div className="flex flex-col gap-3 px-4 py-3.5">
          {tile.titleLabel ? (
            <div className="flex flex-col gap-1">
              <label htmlFor={`t-${d.id}`} className="flex justify-between text-[12.5px] font-semibold">
                {tile.titleLabel}
                {tile.titleLimit ? <span className={cx("font-mono font-normal", titleOver ? "text-danger" : "text-caption")}>{title.length} / {tile.titleLimit}</span> : null}
              </label>
              <input id={`t-${d.id}`} value={title} onChange={(e) => setTitle(e.target.value)} className="min-h-10 rounded-[9px] border border-input bg-surface-muted px-3 text-sm" />
            </div>
          ) : null}
          <div className="flex flex-col gap-1">
            <label htmlFor={`b-${d.id}`} className="flex justify-between text-[12.5px] font-semibold">
              Post
              <span className={cx("font-mono font-normal", over ? "text-danger" : "text-caption")}>{tile.limit ? `${len.toLocaleString()} / ${tile.limit.toLocaleString()}` : `${len.toLocaleString()} chars`}</span>
            </label>
            <textarea id={`b-${d.id}`} rows={10} value={body} onChange={(e) => setBody(e.target.value)} className="resize-y rounded-[9px] border border-input bg-surface-muted p-3 text-[13.5px] leading-[1.55]" />
          </div>
          {tile.firstComment || d.firstComment ? (
            <div className="flex flex-col gap-1">
              <label htmlFor={`c-${d.id}`} className="text-[12.5px] font-semibold">
                First comment
              </label>
              <input id={`c-${d.id}`} value={comment} onChange={(e) => setComment(e.target.value)} className="min-h-10 rounded-[9px] border border-input bg-surface-muted px-3 text-sm" />
            </div>
          ) : null}
        </div>
      ) : (
        <>
          {d.hasPost ? (
            <>
              {d.title ? <div className={cx("px-4 pt-3.5 text-[15px] font-semibold leading-[1.35]", titleOver && "text-danger")}>{d.title}</div> : null}
              {d.subtitle ? <div className="px-4 pt-1 text-[13.5px] italic text-muted">{d.subtitle}</div> : null}
              <div className="max-h-[200px] overflow-y-auto whitespace-pre-line px-4 pb-3.5 pt-3 text-[13.5px] leading-[1.55] text-ink-soft" tabIndex={0} aria-label={`${tile.name} post text`}>
                {d.body}
              </div>
              {d.firstComment ? (
                <div className="mx-4 mb-3 rounded-lg border border-divider bg-surface-muted px-3 py-2 text-[12.5px] text-muted">
                  <span className="font-semibold text-ink">First comment:</span> {d.firstComment}
                </div>
              ) : null}
            </>
          ) : (
            <div className="px-4 pt-3 text-[13px] text-muted">Image only · no post text for this platform</div>
          )}
        </>
      )}

      {!generating && (d.warnings.length || d.notes.length || d.lastError) ? (
        <ul className="m-0 mx-4 mb-3 flex list-none flex-col gap-1 p-0 text-[12.5px] leading-snug">
          {d.warnings.map((w) => (
            <li key={w} className="rounded-md bg-[#FDF3F1] px-2.5 py-1.5 text-danger">
              {w}
            </li>
          ))}
          {d.notes.map((n) => (
            <li key={n} className="text-warn-text">
              {n}
            </li>
          ))}
          {d.lastError && d.status !== "failed" ? <li className="text-danger-text">Last attempt: {d.lastError}</li> : null}
        </ul>
      ) : null}

      {!generating && variants.length && !editing && !locked ? (
        <div className="mx-4 mb-3 flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
          <span>Other variants:</span>
          {variants.map((v, i) => (
            <button
              key={i}
              type="button"
              title={v.body.slice(0, 200)}
              onClick={() => call(`variant${i}`, `/api/drafts/${d.id}`, { useVariant: i }, "PATCH")}
              className="min-h-8 cursor-pointer rounded-md border border-line bg-bg px-2.5 text-xs text-ink hover:border-input"
            >
              Use variant {i + 2}
            </button>
          ))}
        </div>
      ) : null}

      <div className="h-0.5" />
      {(d.images.length ? d.images : wantsImage && !generating ? [null] : []).map((img, n) => {
        const video = !!img?.mimeType.startsWith("video/");
        const failed = img?.status === "failed";
        return (
          <div key={img?.id ?? "none"} className="mx-4 mb-3.5 flex items-center gap-3.5 rounded-xl bg-bg p-3">
            {img && !failed && (img.urls.length || img.status === "generating") ? (
              <Thumb img={img} name={tile.name} />
            ) : (
              <div className="flex h-[132px] w-[132px] shrink-0 items-center justify-center rounded border border-dashed border-dash text-xs text-caption">{failed ? "Failed" : "No image"}</div>
            )}
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <span className="text-xs uppercase tracking-[0.04em] text-caption">{video ? "Video" : "Image"}</span>
              {img && !video && img.generator !== "upload" && img.status !== "generating" ? (
                <>
                  <label htmlFor={`sz-${img.id}`} className="sr-only">
                    Image size for {tile.name}
                  </label>
                  <select
                    id={`sz-${img.id}`}
                    value={img.sizeKey}
                    disabled={locked || !!busy}
                    onChange={(e) => call("size", `/api/drafts/${d.id}/image`, { imageId: img.id, sizeKey: e.target.value, rerender: true })}
                    className="min-h-10 rounded-lg border border-input bg-surface px-2.5 font-mono text-xs text-ink"
                  >
                    {tile.sizes.map((z) => (
                      <option key={z.key} value={z.key}>
                        {z.w} × {z.h} · {z.label}
                      </option>
                    ))}
                    {!tile.sizes.some((z) => z.key === img.sizeKey) ? <option value={img.sizeKey}>{img.sizeKey.replace("x", " × ")} · Custom</option> : null}
                  </select>
                </>
              ) : null}
              <span className="text-xs leading-snug text-muted">{busy === "size" || busy === "regimg" ? "Rendering…" : img?.note ?? "No image yet."}</span>
              {img?.warnings.length ? <span className="text-[11.5px] leading-snug text-warn-text">{img.warnings.join(" ")}</span> : null}
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                {!locked && !video ? (
                  <Button
                    variant="link"
                    size="sm"
                    className="!min-h-8 text-[12.5px]"
                    busy={busy === "regimg"}
                    onClick={() => call("regimg", `/api/drafts/${d.id}/image`, { imageId: img && img.generator !== "upload" ? img.id : undefined })}
                  >
                    {img && img.generator !== "upload" ? "Regenerate image" : "Generate image"}
                  </Button>
                ) : null}
                {img?.urls.length ? (
                  <Button variant="linkMuted" size="sm" className="!min-h-8 text-[12.5px]" onClick={() => downloadAll(img)}>
                    Download{img.urls.length > 1 ? " all" : ""}
                  </Button>
                ) : null}
                {!locked && img && (video || failed || d.images.length > 1) ? (
                  <Button variant="linkMuted" size="sm" className="!min-h-8 text-[12.5px]" onClick={() => call(`rm${img.id}`, `/api/drafts/${d.id}/image?imageId=${img.id}`, undefined, "DELETE")}>
                    Remove
                  </Button>
                ) : null}
                {!locked && n === 0 ? (
                  <Button variant="linkMuted" size="sm" className="!min-h-8 text-[12.5px]" busy={busy === "upload"} onClick={() => fileRef.current?.click()}>
                    Upload my own
                  </Button>
                ) : null}
                {heygen && d.hasPost && !locked && n === 0 && !d.images.some((x) => x.generator === "heygen") ? (
                  <Button variant="linkMuted" size="sm" className="!min-h-8 text-[12.5px]" busy={busy === "video"} onClick={() => call("video", `/api/drafts/${d.id}/video`, {})}>
                    Make avatar video
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
        );
      })}
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/quicktime"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) upload(f);
          e.target.value = "";
        }}
      />

      <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-divider bg-surface-muted px-4 py-3">
        {editing ? (
          <>
            <Button size="sm" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button size="sm" variant="dark" className="ml-auto" busy={busy === "save"} onClick={saveEdit}>
              Save edits
            </Button>
          </>
        ) : (
          <>
            {d.hasPost && !locked ? (
              <Button
                size="sm"
                disabled={generating}
                onClick={() => {
                  setTitle(d.title ?? "");
                  setBody(d.body ?? "");
                  setComment(d.firstComment ?? "");
                  setEditing(true);
                }}
              >
                Edit
              </Button>
            ) : null}
            {d.hasPost && !locked ? (
              <Button size="sm" disabled={generating} busy={busy === "regen"} onClick={() => call("regen", `/api/drafts/${d.id}/regenerate`)}>
                {d.status === "failed" ? "Retry" : "Regenerate"}
              </Button>
            ) : null}
            {d.status === "published" ? (
              d.externalUrl ? (
                <a href={d.externalUrl} target="_blank" rel="noreferrer" className="ml-auto inline-flex min-h-10 items-center rounded-[9px] border border-success bg-success-soft px-3.5 text-[13px] font-semibold !text-success-text no-underline">
                  Live · view post ↗
                </a>
              ) : (
                <span className="ml-auto text-[13px] font-semibold text-success-text">Posted</span>
              )
            ) : d.status === "scheduled" ? (
              <Link href="/schedule" className="ml-auto inline-flex min-h-10 items-center rounded-[9px] border border-success bg-success-soft px-3.5 text-[13px] font-semibold !text-success-text no-underline">
                Scheduled{d.schedule ? ` · ${new Date(d.schedule.runAtUtc).toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` : ""}
              </Link>
            ) : (
              <Button
                size="sm"
                variant={approved ? "success" : "dark"}
                className="ml-auto px-3.5"
                disabled={generating || (d.status === "failed" && !d.body) || (blocked && !approved) || (!d.hasPost && !img)}
                title={blocked ? "Fix the issues above first" : undefined}
                busy={busy === "approve"}
                onClick={primary}
              >
                {primaryLabel}
              </Button>
            )}
          </>
        )}
      </div>
    </article>
  );
}
