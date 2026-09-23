"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, Button, cx, Field, inputCls, inputMutedCls, Monogram, PageHeader, useToast } from "@/components/ui";
import { IconClose, IconSpark } from "@/components/icons";
import { DraftCard } from "@/components/compose/DraftCard";
import type { DraftDTO } from "@/lib/dto";
import type { SizePreset } from "@/lib/platforms";

export type PlatformTile = {
  id: string;
  name: string;
  short: string;
  mono: string;
  color: string;
  mode: string;
  limit: number;
  titleLabel: string | null;
  titleLimit: number | null;
  sizes: SizePreset[];
  enabled: boolean;
  auto: boolean;
  copyMode: boolean;
  firstComment: boolean;
};

type BriefLite = { id: string; text: string; goal: string; tone: string; subreddit: string | null; postPlatforms: string[]; imagePlatforms: string[]; createdAt: string };
type Upload = { platform: string; url: string; mimeType: string; width: number | null; height: number | null; name: string };

const GOALS = ["Traffic / downloads", "Awareness", "Engagement", "Leads"];
const TONES = ["Use platform default", "Professional", "Conversational", "Bold"];
const DEFAULT_POSTS = ["fb", "ig", "lip", "lic", "reddit"];

export function ComposeClient({
  tiles,
  generators,
  hasClaude,
  heygen,
  initialImages,
  initialGenerator,
  initialBrief,
  initialDrafts,
}: {
  tiles: PlatformTile[];
  generators: { id: string; label: string; on: boolean }[];
  hasClaude: boolean;
  heygen: boolean;
  initialImages: string[];
  initialGenerator: string;
  initialBrief: BriefLite | null;
  initialDrafts: DraftDTO[];
}) {
  const router = useRouter();
  const toast = useToast();
  const byId = useMemo(() => Object.fromEntries(tiles.map((t) => [t.id, t])), [tiles]);
  const [text, setText] = useState(initialBrief?.text ?? "");
  const [goal, setGoal] = useState(initialBrief?.goal ?? GOALS[0]);
  const [tone, setTone] = useState(initialBrief?.tone ?? TONES[0]);
  const [subreddit, setSubreddit] = useState(initialBrief?.subreddit ?? "r/startups");
  const [posts, setPosts] = useState<Set<string>>(new Set(initialBrief?.postPlatforms ?? DEFAULT_POSTS.filter((p) => byId[p]?.enabled)));
  const [imgs, setImgs] = useState<Set<string>>(new Set(initialBrief?.imagePlatforms ?? initialImages));
  const [generator, setGenerator] = useState(initialGenerator);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [uploadFor, setUploadFor] = useState<string>("");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [brief, setBrief] = useState<BriefLite | null>(initialBrief);
  const [drafts, setDrafts] = useState<DraftDTO[]>(initialDrafts);
  const [running, setRunning] = useState(false);
  const [posting, setPosting] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<{ id: string; text: string; createdAt: string; platforms: string[]; statuses: string[] }[] | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const uploadedSet = new Set(uploads.map((u) => u.platform));
  const nPosts = posts.size;
  const nImgs = new Set([...imgs].filter((p) => !uploadedSet.has(p))).size;
  const anything = nPosts + nImgs + uploads.length > 0;
  const generateLabel = anything
    ? `Generate ${[nPosts ? `${nPosts} post${nPosts === 1 ? "" : "s"}` : "", nImgs ? `${nImgs} image${nImgs === 1 ? "" : "s"}` : ""].filter(Boolean).join(" + ") || "with your uploads"}`
    : "Select platforms";
  const approvedDrafts = drafts.filter((d) => d.status === "approved");
  const done = drafts.filter((d) => d.status !== "generating").length;

  const toggle = (set: Set<string>, id: string, fn: (s: Set<string>) => void) => {
    const n = new Set(set);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    fn(n);
  };

  const updateDraft = (d: DraftDTO) => setDrafts((xs) => xs.map((x) => (x.id === d.id ? d : x)));

  // Background media (HeyGen video) and cards left generating by a closed tab: poll until settled.
  const pending = !running && drafts.some((d) => d.status === "generating" || d.images.some((i) => i.status === "generating"));
  useEffect(() => {
    if (!pending || !brief) return;
    const t = setInterval(async () => {
      try {
        const r = await api<{ drafts: DraftDTO[] }>(`/api/briefs/${brief.id}`);
        setDrafts(r.drafts);
      } catch {
        /* keep polling */
      }
    }, 5000);
    return () => clearInterval(t);
  }, [pending, brief]);

  async function generate() {
    if (!hasClaude) {
      toast("Add your Claude API key in Claude API & accounts first.", "error");
      return;
    }
    setRunning(true);
    try {
      const res = await fetch("/api/briefs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          goal,
          tone,
          subreddit: posts.has("reddit") || imgs.has("reddit") ? subreddit : null,
          postPlatforms: [...posts],
          imagePlatforms: [...imgs],
          generator,
          uploads: uploads.map(({ name: _n, ...u }) => u),
        }),
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.issues?.[0]?.message ?? j.error ?? "Generation failed");
      }
      setUploads([]);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      const errors: string[] = [];
      for (;;) {
        const { value, done: end } = await reader.read();
        if (end) break;
        buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          const ev = JSON.parse(line);
          if (ev.type === "brief") {
            setBrief({ ...ev.brief, goal, tone, subreddit, postPlatforms: [...posts], imagePlatforms: [...imgs] });
            setDrafts(ev.drafts);
            window.history.replaceState(null, "", `/compose?brief=${ev.brief.id}`);
          } else if (ev.type === "draft") updateDraft(ev.draft);
          else if (ev.type === "error") errors.push(ev.platform ? `${byId[ev.platform]?.name ?? ev.platform}: ${ev.message}` : ev.message);
        }
      }
      if (errors.length) toast(errors[0], "error");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setRunning(false);
    }
  }

  async function postNow() {
    const eligible = approvedDrafts.filter((d) => byId[d.platform]?.auto);
    if (!eligible.length) {
      toast(approvedDrafts.length ? "None of the approved drafts can auto-post. Connect accounts in Claude API & accounts, or schedule a reminder." : "Approve at least one draft first.", "error");
      return;
    }
    if (!confirm(`Publish ${eligible.length} approved post${eligible.length === 1 ? "" : "s"} now to ${eligible.map((d) => byId[d.platform].short).join(", ")}?`)) return;
    setPosting(true);
    try {
      const r = await api<{ results: { draftId: string; platform: string; ok: boolean; url?: string; error?: string; skipped?: string }[] }>("/api/publish", { method: "POST", json: { draftIds: eligible.map((d) => d.id) } });
      const ok = r.results.filter((x) => x.ok);
      const bad = r.results.filter((x) => !x.ok);
      if (ok.length) toast(`Published to ${ok.map((x) => byId[x.platform].short).join(", ")}`, "ok");
      for (const b of bad) toast(`${byId[b.platform].short}: ${b.error ?? b.skipped}`, "error");
      if (brief) {
        const fresh = await api<{ drafts: DraftDTO[] }>(`/api/briefs/${brief.id}`);
        setDrafts(fresh.drafts);
      }
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setPosting(false);
    }
  }

  async function openHistory() {
    setHistoryOpen(true);
    const r = await api<{ briefs: typeof history }>("/api/briefs");
    setHistory(r.briefs);
  }

  async function onUploadFile(f: File) {
    if (!uploadFor) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", f);
      const res = await fetch("/api/uploads", { method: "POST", body: fd });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Upload failed");
      setUploads((xs) => [...xs.filter((x) => x.platform !== uploadFor), { platform: uploadFor, url: j.url, mimeType: j.mimeType, width: j.width, height: j.height, name: f.name }]);
      setUploadOpen(false);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setUploading(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Compose"
        title="One brief, every platform."
        actions={
          <>
            <Button onClick={openHistory}>Drafts history</Button>
            <Button onClick={postNow} busy={posting}>
              Post now
            </Button>
            <Link
              href="/schedule"
              className="inline-flex min-h-11 items-center gap-2 rounded-[10px] border border-ink bg-ink px-[18px] text-sm font-medium !text-white no-underline hover:bg-ink-soft"
            >
              Schedule approved ({approvedDrafts.length})
            </Link>
          </>
        }
      />

      {!hasClaude ? (
        <div className="rounded-xl border border-[#F0D9BE] bg-warn-soft px-4 py-3 text-[14px] text-warn-text">
          Multicast needs a Claude API key to write drafts. <Link href="/settings">Add it in Claude API &amp; accounts</Link>. Everything else is optional.
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 items-start gap-7">
        <section aria-label="Brief" className="flex w-[460px] shrink-0 flex-col gap-[22px] rounded-[16px] border border-line bg-surface p-[26px]">
          <div className="flex flex-col gap-2">
            <label htmlFor="brief" className="text-sm font-semibold">
              What do you want to post about?
            </label>
            <textarea
              id="brief"
              rows={6}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={"We've published a free guide on … Target: … Goal: …\nLink: https://…"}
              className="w-full resize-y rounded-[10px] border border-input bg-surface-muted p-3.5 text-[14.5px] leading-[1.55] text-ink"
            />
            <span className="text-[12.5px] text-caption">Each platform&apos;s system prompt shapes this brief into its own format. Add a line like &quot;Link: https://…&quot; for the link.</span>
          </div>

          <div className="grid grid-cols-2 gap-3.5">
            <Field label="Goal">
              {(id) => (
                <select id={id} className={inputCls} value={goal} onChange={(e) => setGoal(e.target.value)}>
                  {GOALS.map((g) => (
                    <option key={g}>{g}</option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="Tone override">
              {(id) => (
                <select id={id} className={inputCls} value={tone} onChange={(e) => setTone(e.target.value)}>
                  {TONES.map((g) => (
                    <option key={g}>{g}</option>
                  ))}
                </select>
              )}
            </Field>
          </div>

          <fieldset className="m-0 flex flex-col gap-2.5 border-0 p-0">
            <div className="flex items-center justify-between">
              <legend className="float-left p-0 text-[13px] font-semibold">Posts for</legend>
              <div className="flex gap-1">
                <button type="button" onClick={() => setPosts(new Set(tiles.filter((t) => t.enabled).map((t) => t.id)))} className="min-h-8 cursor-pointer border-0 bg-transparent px-2.5 text-[13px] text-accent">
                  Select all
                </button>
                <button type="button" onClick={() => setPosts(new Set())} className="min-h-8 cursor-pointer border-0 bg-transparent px-2.5 text-[13px] text-caption">
                  Clear
                </button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {tiles.map((p) => {
                const on = posts.has(p.id);
                return (
                  <label
                    key={p.id}
                    className={cx(
                      "box-border flex min-h-[52px] cursor-pointer items-center gap-2.5 rounded-[10px] border px-3 py-2",
                      on ? "border-accent bg-accent-soft" : "border-line bg-surface",
                      !p.enabled && "cursor-not-allowed opacity-55",
                    )}
                  >
                    <input type="checkbox" checked={on} disabled={!p.enabled} onChange={() => toggle(posts, p.id, setPosts)} className="m-0 h-[18px] w-[18px] shrink-0 accent-accent" />
                    <Monogram mono={p.mono} color={p.color} size={26} radius={7} />
                    <span className="flex min-w-0 flex-col">
                      <span className="whitespace-nowrap text-[13.5px] font-medium">{p.name}</span>
                      <span className="text-[11.5px] leading-snug text-caption">{!p.enabled ? "Disabled in Platform prompts" : p.id === "reddit" && subreddit ? `Auto-post · ${subreddit}` : p.mode}</span>
                    </span>
                  </label>
                );
              })}
            </div>
            {posts.has("reddit") || imgs.has("reddit") ? (
              <Field label="Subreddit" hint="Its rules are fetched and passed to the prompt before writing.">
                {(id) => <input id={id} className={inputMutedCls + " font-mono"} value={subreddit} onChange={(e) => setSubreddit(e.target.value)} placeholder="r/startups" />}
              </Field>
            ) : null}
          </fieldset>

          <fieldset className="m-0 flex flex-col gap-3 rounded-xl border-0 bg-bg p-4">
            <div className="flex items-center justify-between">
              <legend className="float-left p-0 text-[13px] font-semibold">Images for</legend>
              <div className="flex gap-3.5">
                <Link href="/prompts" className="text-[12.5px]">
                  Sizes &amp; image prompts
                </Link>
                <Link href="/brand" className="text-[12.5px]">
                  Brand kit
                </Link>
              </div>
            </div>
            <span className="-mt-1 text-xs leading-snug text-muted">Separate from posts. Pick only the platforms that need a visual.</span>
            <div className="flex flex-wrap gap-1.5">
              {tiles.map((p) => {
                const on = imgs.has(p.id);
                return (
                  <label
                    key={p.id}
                    className={cx("box-border inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-[20px] border px-3 text-[13px] text-ink", on ? "border-accent bg-accent-soft" : "border-input bg-surface")}
                  >
                    <input type="checkbox" checked={on} onChange={() => toggle(imgs, p.id, setImgs)} className="m-0 h-4 w-4 shrink-0 accent-accent" />
                    {p.short}
                  </label>
                );
              })}
            </div>
            <div className="flex gap-2">
              <div className="flex flex-1 flex-col gap-1.5">
                <label htmlFor="gen" className="text-[12.5px] text-muted">
                  Image generator
                </label>
                <select id="gen" className={inputCls + " text-[13.5px]"} value={generator} onChange={(e) => setGenerator(e.target.value)}>
                  {generators.map((g) => (
                    <option key={g.id} value={g.id} disabled={!g.on}>
                      {g.label}
                      {g.on ? "" : " · connect first"}
                    </option>
                  ))}
                </select>
              </div>
              <Button variant="dashed" className="self-end !bg-surface !text-ink" aria-expanded={uploadOpen} onClick={() => setUploadOpen((x) => !x)}>
                Upload my own
              </Button>
            </div>
            {uploadOpen ? (
              <div className="flex flex-col gap-2 rounded-[10px] border border-line bg-surface p-3">
                <Field label="Attach to">
                  {(id) => (
                    <select id={id} className={inputCls} value={uploadFor} onChange={(e) => setUploadFor(e.target.value)}>
                      <option value="">Choose a platform…</option>
                      {tiles.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
                <Button variant="dark" size="sm" disabled={!uploadFor} busy={uploading} onClick={() => fileRef.current?.click()}>
                  Choose image or video
                </Button>
                <input
                  ref={fileRef}
                  type="file"
                  className="hidden"
                  accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/quicktime"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) onUploadFile(f);
                    e.target.value = "";
                  }}
                />
                <span className="text-xs text-caption">Uploaded media is used instead of generating an image for that platform.</span>
              </div>
            ) : null}
            {uploads.length ? (
              <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
                {uploads.map((u) => (
                  <li key={u.platform} className="inline-flex min-h-8 items-center gap-1.5 rounded-2xl border border-line bg-surface pl-3 pr-1 text-[12.5px]">
                    {byId[u.platform]?.short}: <span className="max-w-[140px] truncate">{u.name}</span>
                    <button type="button" aria-label={`Remove upload for ${byId[u.platform]?.short}`} onClick={() => setUploads((xs) => xs.filter((x) => x.platform !== u.platform))} className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent text-muted">
                      <IconClose />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </fieldset>

          <Button variant="primary" size="lg" onClick={generate} busy={running} disabled={!anything || text.trim().length < 5}>
            {running ? null : <IconSpark />}
            {running ? `Generating ${done} of ${drafts.length}…` : generateLabel}
          </Button>
        </section>

        <section aria-label="Drafts" className="flex min-w-0 flex-1 flex-col gap-4">
          <div className="flex items-baseline justify-between">
            <h2 className="m-0 font-display text-2xl font-medium">Drafts</h2>
            <span className="text-[13px] text-caption" role="status">
              {running ? `Generating · ${done} of ${drafts.length} ready` : brief ? `Brief from ${new Date(brief.createdAt).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} · generated with your platform prompts` : ""}
            </span>
          </div>
          {!drafts.length ? (
            <div className="rounded-[16px] border border-dashed border-dash p-12 text-center text-[15px] text-muted">
              {anything ? "Write a brief and press Generate. Each selected platform gets its own card." : "Pick at least one platform for a post or an image."}
            </div>
          ) : null}
          <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
            {drafts.map((d) => (
              <DraftCard key={d.id} draft={d} tile={byId[d.platform]} wantsImage={!!brief?.imagePlatforms.includes(d.platform) || d.images.length > 0} heygen={heygen} onChange={updateDraft} />
            ))}
          </div>
        </section>
      </div>

      {historyOpen ? (
        <div className="fixed inset-0 z-40 flex justify-end bg-[rgba(27,26,23,0.35)]" onClick={() => setHistoryOpen(false)}>
          <aside role="dialog" aria-modal="true" aria-label="Drafts history" className="flex h-full w-[440px] max-w-full flex-col gap-3 overflow-y-auto bg-surface p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="m-0 font-display text-2xl font-medium">Drafts history</h2>
              <button type="button" aria-label="Close" onClick={() => setHistoryOpen(false)} className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-[9px] border border-input bg-surface">
                <IconClose />
              </button>
            </div>
            {!history ? <span className="text-sm text-muted">Loading…</span> : null}
            {history?.length === 0 ? <span className="text-sm text-muted">No briefs yet.</span> : null}
            {history?.map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => {
                  setHistoryOpen(false);
                  router.push(`/compose?brief=${b.id}`);
                }}
                className={cx("flex cursor-pointer flex-col gap-1.5 rounded-xl border p-3.5 text-left", b.id === brief?.id ? "border-accent bg-accent-soft" : "border-line bg-surface hover:bg-surface-muted")}
              >
                <span className="line-clamp-2 text-[13.5px] text-ink">{b.text}</span>
                <span className="flex flex-wrap items-center gap-1.5 text-xs text-caption">
                  {new Date(b.createdAt).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                  {b.platforms.map((p, i) => (
                    <span key={p} title={b.statuses[i]}>
                      <Monogram mono={byId[p]?.mono ?? p} color={byId[p]?.color ?? "#999"} size={18} radius={4} />
                    </span>
                  ))}
                </span>
              </button>
            ))}
          </aside>
        </div>
      ) : null}
    </>
  );
}
