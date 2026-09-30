import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { db } from "@/lib/db";
import { rateLimit } from "@/lib/api";
import { HttpError } from "@/lib/errors";
import { PLATFORM_IDS, PLATFORMS, type PlatformId } from "@/lib/platforms";
import { GOALS, TONES } from "@/lib/prompts/assemble";
import { draftDTO, type DraftDTO } from "@/lib/dto";
import { approveDraft, attachMedia, deleteDraft, editDraft, loadDraftDTO, ownedDraft } from "@/lib/drafts";
import { createBrief, createManualDraft } from "@/lib/briefs";
import { regenerateImage, regenerateText, runBrief } from "@/lib/generation/run";
import { canAuto, publishMany } from "@/lib/publishers";
import { scheduleDraft, suggestionsFor, unschedule, workspaceTz } from "@/lib/schedule/service";
import { schedulerAvailable } from "@/lib/schedule/queue";
import { zonedToUtc } from "@/lib/schedule/time";
import { fetchMedia } from "@/lib/mcp/media";
import { errMsg } from "@/lib/util";

// Multicast over MCP: the same drafts, approval rules, publishers and scheduler as the web
// app, called by an external agent. Every tool runs as the workspace the bearer token belongs to.

const Platform = z.enum(PLATFORM_IDS).describe(`Platform id: ${PLATFORM_IDS.map((p) => `${p} = ${PLATFORMS[p].name}`).join(", ")}`);
const STATUSES = ["generating", "ready", "warning", "approved", "scheduled", "published", "failed"] as const;

/** Compact post shape for agents: what they need to read, decide and act on. */
function post(d: DraftDTO) {
  return {
    id: d.id,
    brief_id: d.briefId,
    platform: d.platform,
    platform_name: PLATFORMS[d.platform as PlatformId]?.name ?? d.platform,
    status: d.status,
    ...(d.title ? { title: d.title } : {}),
    ...(d.subtitle ? { subtitle: d.subtitle } : {}),
    ...(d.slug ? { slug: d.slug } : {}),
    body: d.body,
    ...(d.firstComment ? { first_comment: d.firstComment } : {}),
    hashtags: d.hashtags,
    ...(d.warnings.length ? { blocking_issues: d.warnings } : {}),
    ...(d.notes.length ? { notes: d.notes } : {}),
    media: d.images.map((i) => ({ id: i.id, status: i.status, type: i.mimeType, size: `${i.width}x${i.height}`, urls: i.urls })),
    schedule: d.schedule ? { run_at: d.schedule.runAtUtc, mode: d.schedule.mode, status: d.schedule.status } : null,
    published_url: d.externalUrl ?? d.schedule?.externalUrl ?? null,
    ...(d.lastError ? { last_error: d.lastError } : {}),
  };
}

const ok = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] });
const fail = (e: unknown) => ({ isError: true, content: [{ type: "text" as const, text: errMsg(e) }] });

function wrap<A>(fn: (args: A) => Promise<unknown>) {
  return async (args: A) => {
    try {
      return ok(await fn(args));
    } catch (e) {
      return fail(e);
    }
  };
}

/**
 * "2026-10-02T09:30:00Z" / "+04:00" are exact; "2026-10-02T09:30" (no offset) is read in
 * the workspace time zone, which is what a person saying "9:30 on Friday" means.
 */
export function parseRunAt(s: string, tz: string): Date {
  const local = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/);
  if (local) {
    const [, y, m, d, h, min] = local.map(Number);
    return zonedToUtc(y, m, d, h, min, tz);
  }
  const t = new Date(s);
  if (Number.isNaN(t.getTime())) throw new HttpError(400, `Not a date-time: ${s}. Use ISO 8601, e.g. 2026-10-02T09:30 (workspace time) or 2026-10-02T09:30:00Z.`);
  return t;
}

export function buildMcpServer(workspaceId: string) {
  const server = new McpServer(
    { name: "multicast", title: "Multicast", version: "1.0.0" },
    {
      instructions: [
        "Multicast turns a brief into platform-native social posts (Facebook, Instagram, X, LinkedIn, Quora, Medium, Blog, Reddit), then publishes or schedules them.",
        "Flow: generate_posts (Claude writes them) or create_post (your own text) -> review with get_post -> update_post if needed -> approve_post -> publish_now or schedule_post.",
        "Only approved posts can be published or scheduled. Posts with blocking_issues must be edited first.",
        "Call get_workspace first to see which platforms can auto-post and the workspace time zone. Platforms that can't auto-post are scheduled as reminders (Remind me).",
        "Publishing is public and immediate: confirm with the user before publish_now.",
      ].join(" "),
    },
  );

  server.registerTool(
    "get_workspace",
    {
      title: "Workspace and platforms",
      description: "Time zone, whether Claude drafting and scheduling are set up, and for each platform: whether it can auto-post now (account connected) or only copy/remind.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    wrap(async () => {
      const [tz, settings] = await Promise.all([workspaceTz(workspaceId), db.settings.findUnique({ where: { workspaceId }, select: { claudeKeyEnc: true } })]);
      const platforms = [];
      for (const id of PLATFORM_IDS) {
        const p = PLATFORMS[id];
        platforms.push({ id, name: p.name, auto_post: await canAuto(workspaceId, id), publish: p.publish.label, text_limit: p.textLimit || null });
      }
      return { time_zone: tz, claude_connected: !!settings?.claudeKeyEnc, scheduling_available: schedulerAvailable(), goals: GOALS, tones: TONES, platforms };
    }),
  );

  server.registerTool(
    "generate_posts",
    {
      title: "Generate posts from a brief",
      description:
        "Claude writes one platform-native post per platform from a brief, following the workspace's brand voice and platform prompts, and optionally renders branded images. Takes up to a few minutes. Returns the drafts (not yet approved).",
      inputSchema: {
        brief: z.string().min(5).max(8000).describe("What to post about. Include any link to promote."),
        platforms: z.array(Platform).min(1).describe("Platforms to write a post for"),
        image_platforms: z.array(Platform).optional().describe("Platforms to also render a branded image for"),
        goal: z.enum(GOALS as [string, ...string[]]).optional().describe("Default Awareness"),
        tone: z.enum(TONES as [string, ...string[]]).optional().describe("Default: each platform's own tone"),
        subreddit: z.string().optional().describe("Required when platforms includes reddit"),
        keyword: z.string().optional().describe("Target SEO keyword for blog / medium"),
      },
    },
    wrap(async (a: { brief: string; platforms: PlatformId[]; image_platforms?: PlatformId[]; goal?: string; tone?: string; subreddit?: string; keyword?: string }) => {
      rateLimit(`gen:${workspaceId}`, 12, 60_000);
      const { brief } = await createBrief(workspaceId, {
        text: a.brief,
        goal: a.goal ?? "Awareness",
        tone: a.tone ?? "Use platform default",
        subreddit: a.subreddit ?? null,
        keyword: a.keyword ?? null,
        postPlatforms: a.platforms,
        imagePlatforms: a.image_platforms ?? [],
        generator: "builtin",
        uploads: [],
      });
      const errors: string[] = [];
      await runBrief(workspaceId, brief.id, (e) => {
        if (e.type === "error") errors.push(e.platform ? `${e.platform}: ${e.message}` : e.message);
      });
      const drafts = await db.draft.findMany({ where: { briefId: brief.id }, include: { images: true, schedule: true }, orderBy: { createdAt: "asc" } });
      return { brief_id: brief.id, posts: drafts.map((d) => post(draftDTO(d))), ...(errors.length ? { errors } : {}) };
    }),
  );

  server.registerTool(
    "create_post",
    {
      title: "Create a post from your own text",
      description: "Save a post you already wrote as a Multicast draft, checked against the platform's limits and banned phrases. No Claude call. Optionally attach images or a video by public URL.",
      inputSchema: {
        platform: Platform,
        body: z.string().min(1).max(100_000).describe("Post text (Markdown for blog / medium)"),
        title: z.string().max(1000).optional().describe("Title: required for reddit, medium, blog, quora"),
        subtitle: z.string().max(1000).optional().describe("Medium subtitle or blog meta description"),
        slug: z.string().max(120).optional().describe("Blog URL slug"),
        hashtags: z.array(z.string()).max(30).optional(),
        first_comment: z.string().max(3000).optional().describe("Posted as the first comment (or an X reply), e.g. for the link"),
        subreddit: z.string().optional().describe("Required for reddit"),
        media_urls: z.array(z.string().url()).max(10).optional().describe("Public https URLs of images (PNG, JPEG, WebP, GIF) or one MP4 video"),
        approve: z.boolean().optional().describe("Approve right away if it passes the checks (default false)"),
      },
    },
    wrap(async (a: { platform: PlatformId; body: string; title?: string; subtitle?: string; slug?: string; hashtags?: string[]; first_comment?: string; subreddit?: string; media_urls?: string[]; approve?: boolean }) => {
      const id = await createManualDraft(workspaceId, { platform: a.platform, body: a.body, title: a.title, subtitle: a.subtitle, slug: a.slug, hashtags: a.hashtags, firstComment: a.first_comment, subreddit: a.subreddit });
      for (const url of a.media_urls ?? []) await attachMedia(workspaceId, id, await fetchMedia(url), false);
      const d = a.approve ? await approveDraft(workspaceId, id, true).catch(async (e) => ({ ...(await loadDraftDTO(id)), approveError: errMsg(e) })) : await loadDraftDTO(id);
      const { approveError, ...dto } = d as DraftDTO & { approveError?: string };
      return { post: post(dto), ...(approveError ? { not_approved: approveError } : {}) };
    }),
  );

  server.registerTool(
    "list_posts",
    {
      title: "List posts",
      description: "Recent posts, newest first. Filter by status (e.g. published to retrieve what went live, with URLs), platform or brief.",
      inputSchema: {
        status: z.array(z.enum(STATUSES)).optional(),
        platform: Platform.optional(),
        brief_id: z.string().optional(),
        limit: z.number().int().min(1).max(100).optional().describe("Default 20"),
      },
      annotations: { readOnlyHint: true },
    },
    wrap(async (a: { status?: string[]; platform?: PlatformId; brief_id?: string; limit?: number }) => {
      const drafts = await db.draft.findMany({
        where: { workspaceId, ...(a.status?.length ? { status: { in: a.status } } : {}), ...(a.platform ? { platform: a.platform } : {}), ...(a.brief_id ? { briefId: a.brief_id } : {}) },
        include: { images: true, schedule: true },
        orderBy: { updatedAt: "desc" },
        take: a.limit ?? 20,
      });
      return { posts: drafts.map((d) => ({ ...post(draftDTO(d)), updated_at: d.updatedAt.toISOString(), ...(d.publishedAt ? { published_at: d.publishedAt.toISOString() } : {}) })) };
    }),
  );

  server.registerTool(
    "get_post",
    {
      title: "Get a post",
      description: "One post in full: text, media URLs, blocking issues, schedule and live URL.",
      inputSchema: { id: z.string() },
      annotations: { readOnlyHint: true },
    },
    wrap(async (a: { id: string }) => {
      const d = await ownedDraft(workspaceId, a.id);
      return { post: post(draftDTO(d)), brief: d.brief.text, alternatives: d.variants ?? undefined };
    }),
  );

  server.registerTool(
    "update_post",
    {
      title: "Edit a post",
      description: "Change a post's text fields. Checks re-run; an approved post goes back to needing approval. Scheduled posts must be unscheduled first.",
      inputSchema: {
        id: z.string(),
        body: z.string().max(100_000).optional(),
        title: z.string().max(1000).nullable().optional(),
        subtitle: z.string().max(1000).nullable().optional(),
        slug: z.string().max(120).nullable().optional(),
        hashtags: z.array(z.string().max(100)).max(30).optional(),
        first_comment: z.string().max(3000).nullable().optional(),
        use_alternative: z.number().int().min(0).max(2).optional().describe("Swap in alternative N from get_post instead of editing"),
      },
    },
    wrap(async (a: { id: string; body?: string; title?: string | null; subtitle?: string | null; slug?: string | null; hashtags?: string[]; first_comment?: string | null; use_alternative?: number }) =>
      ({ post: post(await editDraft(workspaceId, a.id, { body: a.body, title: a.title, subtitle: a.subtitle, slug: a.slug, hashtags: a.hashtags, firstComment: a.first_comment, useVariant: a.use_alternative })) }),
    ),
  );

  server.registerTool(
    "regenerate_post",
    {
      title: "Rewrite a post",
      description: "Have Claude write this platform's post again from the same brief (media is kept).",
      inputSchema: { id: z.string() },
    },
    wrap(async (a: { id: string }) => {
      rateLimit(`gen:${workspaceId}`, 30, 60_000);
      const d = await ownedDraft(workspaceId, a.id);
      if (!d.hasPost) throw new HttpError(400, "This card is image only; use generate_image.");
      if (["scheduled", "published"].includes(d.status)) throw new HttpError(400, "Unschedule this post before regenerating it.");
      return { post: post(await regenerateText(workspaceId, a.id)) };
    }),
  );

  server.registerTool(
    "generate_image",
    {
      title: "Generate a branded image",
      description: "Render (or re-render) the post's branded image with the brand kit. Size like 1080x1350; defaults to the platform's preferred size.",
      inputSchema: { id: z.string(), size: z.string().regex(/^\d{2,4}x\d{2,4}$/).optional() },
    },
    wrap(async (a: { id: string; size?: string }) => {
      rateLimit(`gen:${workspaceId}`, 30, 60_000);
      const d = await ownedDraft(workspaceId, a.id);
      if (["scheduled", "published"].includes(d.status)) throw new HttpError(400, "Unschedule this post before changing its image.");
      const target = d.images.find((i) => i.generator !== "upload");
      return { post: post(await regenerateImage(workspaceId, a.id, { imageId: target?.id, sizeKey: a.size, generator: "builtin" })) };
    }),
  );

  server.registerTool(
    "attach_media",
    {
      title: "Attach an image or video",
      description: "Download a public https image (PNG, JPEG, WebP, GIF, max 20 MB) or MP4 video (max 200 MB) and attach it to the post.",
      inputSchema: { id: z.string(), url: z.string().url(), replace: z.boolean().optional().describe("Remove the post's current media first") },
    },
    wrap(async (a: { id: string; url: string; replace?: boolean }) => ({ post: post(await attachMedia(workspaceId, a.id, await fetchMedia(a.url), !!a.replace)) })),
  );

  server.registerTool(
    "approve_post",
    {
      title: "Approve a post",
      description: "Mark a post ready to publish or schedule. Refused while it has blocking_issues. Pass approved=false to un-approve.",
      inputSchema: { id: z.string(), approved: z.boolean().optional().describe("Default true") },
    },
    wrap(async (a: { id: string; approved?: boolean }) => ({ post: post(await approveDraft(workspaceId, a.id, a.approved ?? true)) })),
  );

  server.registerTool(
    "publish_now",
    {
      title: "Publish now",
      description: "Post approved posts to their platforms immediately. Public and irreversible from here: confirm with the user first. Platforms without a connected account are skipped.",
      inputSchema: { ids: z.array(z.string()).min(1).max(20) },
      annotations: { destructiveHint: false, openWorldHint: true },
    },
    wrap(async (a: { ids: string[] }) => ({ results: await publishMany(workspaceId, a.ids) })),
  );

  server.registerTool(
    "suggest_times",
    {
      title: "Suggest posting times",
      description: "Next good slots for these posts, from each platform's posting window, keeping 3 hours between posts on the same account.",
      inputSchema: { ids: z.array(z.string()).min(1).max(50) },
      annotations: { readOnlyHint: true },
    },
    wrap(async (a: { ids: string[] }) => {
      const drafts = await db.draft.findMany({ where: { id: { in: a.ids }, workspaceId }, select: { id: true, platform: true } });
      const s = await suggestionsFor(workspaceId, drafts);
      return { time_zone: await workspaceTz(workspaceId), suggestions: Object.fromEntries(Object.entries(s).map(([k, v]) => [k, v?.toISOString() ?? null])) };
    }),
  );

  server.registerTool(
    "schedule_post",
    {
      title: "Schedule a post",
      description:
        "Schedule (or reschedule) an approved post. mode auto posts it at that time; remind sends you the final copy instead. Platforms that can't auto-post always use remind. Omit run_at to use the next suggested slot.",
      inputSchema: {
        id: z.string(),
        run_at: z.string().optional().describe("ISO 8601. With Z or an offset it's exact; without (2026-10-02T09:30) it's workspace local time."),
        mode: z.enum(["auto", "remind"]).optional().describe("Default auto"),
      },
    },
    wrap(async (a: { id: string; run_at?: string; mode?: "auto" | "remind" }) => {
      const tz = await workspaceTz(workspaceId);
      let at: Date;
      if (a.run_at) at = parseRunAt(a.run_at, tz);
      else {
        const d = await ownedDraft(workspaceId, a.id);
        const s = (await suggestionsFor(workspaceId, [{ id: d.id, platform: d.platform }]))[d.id];
        if (!s) throw new HttpError(400, "No free slot in the posting window in the next four weeks; pass run_at.");
        at = s;
      }
      const item = await scheduleDraft(workspaceId, a.id, at, a.mode ?? "auto");
      return { scheduled: { post_id: a.id, run_at: item.runAtUtc.toISOString(), time_zone: tz, mode: item.mode, ...(a.mode !== "remind" && item.mode === "remind" ? { note: "This platform can't auto-post, so you'll get a reminder instead." } : {}) } };
    }),
  );

  server.registerTool(
    "list_schedule",
    {
      title: "List the schedule",
      description: "Scheduled items in a time range (default: now to 30 days ahead), with their post text and status.",
      inputSchema: {
        from: z.string().optional().describe("ISO 8601, default now"),
        to: z.string().optional().describe("ISO 8601, default 30 days from now"),
        status: z.array(z.enum(["pending", "sent", "published", "failed", "cancelled"])).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    wrap(async (a: { from?: string; to?: string; status?: string[] }) => {
      const tz = await workspaceTz(workspaceId);
      const from = a.from ? parseRunAt(a.from, tz) : new Date();
      const to = a.to ? parseRunAt(a.to, tz) : new Date(Date.now() + 30 * 86400_000);
      const items = await db.scheduleItem.findMany({
        where: { workspaceId, runAtUtc: { gte: from, lte: to }, ...(a.status?.length ? { status: { in: a.status } } : {}) },
        include: { draft: { select: { id: true, title: true, body: true } } },
        orderBy: { runAtUtc: "asc" },
      });
      return {
        time_zone: tz,
        items: items.map((i) => ({
          post_id: i.draftId,
          platform: i.platform,
          run_at: i.runAtUtc.toISOString(),
          mode: i.mode,
          status: i.status,
          ...(i.draft.title ? { title: i.draft.title } : {}),
          preview: (i.draft.body ?? "").slice(0, 160),
          ...(i.externalUrl ? { published_url: i.externalUrl } : {}),
          ...(i.lastError ? { last_error: i.lastError } : {}),
        })),
      };
    }),
  );

  server.registerTool(
    "unschedule_post",
    {
      title: "Unschedule a post",
      description: "Cancel a scheduled post. It stays approved so it can be rescheduled or published.",
      inputSchema: { id: z.string().describe("Post id") },
    },
    wrap(async (a: { id: string }) => {
      const d = await ownedDraft(workspaceId, a.id);
      if (!d.schedule) throw new HttpError(400, "This post isn't scheduled.");
      await unschedule(workspaceId, d.schedule.id);
      return { post: post(await loadDraftDTO(a.id)) };
    }),
  );

  server.registerTool(
    "delete_post",
    {
      title: "Delete a draft",
      description: "Delete a post from Multicast. Doesn't remove anything already live on a platform.",
      inputSchema: { id: z.string() },
      annotations: { destructiveHint: true },
    },
    wrap(async (a: { id: string }) => {
      await deleteDraft(workspaceId, a.id);
      return { deleted: a.id };
    }),
  );

  return server;
}
