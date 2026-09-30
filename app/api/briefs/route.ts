import { body, rateLimit, route } from "@/lib/api";
import { db } from "@/lib/db";
import { runBrief, type GenEvent } from "@/lib/generation/run";
import { draftDTO } from "@/lib/dto";
import { BriefSchema, createBrief } from "@/lib/briefs";

/** Drafts history: previous briefs. */
export const GET = route(async (_req, ctx) => {
  const briefs = await db.brief.findMany({
    where: { workspaceId: ctx.workspaceId },
    orderBy: { createdAt: "desc" },
    take: 40,
    include: { drafts: { select: { platform: true, status: true } } },
  });
  return {
    briefs: briefs.map((b) => ({ id: b.id, text: b.text, createdAt: b.createdAt, platforms: b.drafts.map((d) => d.platform), statuses: b.drafts.map((d) => d.status) })),
  };
});

/**
 * Create a brief and generate every selected platform. The response is an NDJSON stream:
 * first {"type":"brief"} with placeholder cards, then one {"type":"draft"} per finished card.
 */
export const POST = route(async (req, ctx) => {
  rateLimit(`gen:${ctx.workspaceId}`, 12, 60_000);
  const b = await body(req, BriefSchema);
  const { brief, rows } = await createBrief(ctx.workspaceId, b);
  await db.settings.update({ where: { workspaceId: ctx.workspaceId }, data: { lastImagePlatforms: b.imagePlatforms, lastGenerator: b.generator } });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: unknown) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
        } catch {
          /* client went away; generation continues and drafts persist */
        }
      };
      send({ type: "brief", brief: { id: brief.id, text: brief.text, createdAt: brief.createdAt }, drafts: rows.map(draftDTO) });
      try {
        await runBrief(ctx.workspaceId, brief.id, (e: GenEvent) => send(e));
      } catch (e) {
        send({ type: "error", message: e instanceof Error ? e.message : String(e) });
        send({ type: "done" });
      }
      try {
        controller.close();
      } catch {
        /* already closed */
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
});

// Generation, rendering and publishing can take minutes (Vercel function limit).
export const maxDuration = 300;
