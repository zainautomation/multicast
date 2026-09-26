import { db } from "@/lib/db";
import { requireCtx } from "@/lib/auth";
import { draftDTO } from "@/lib/dto";
import { connectedTypes } from "@/lib/integrations/store";
import { canAuto } from "@/lib/publishers";
import { PLATFORM_LIST, type PlatformId } from "@/lib/platforms";
import { getLayers } from "@/lib/prompts/layers";
import { ComposeClient, type PlatformTile } from "@/components/compose/ComposeClient";

export const dynamic = "force-dynamic";

export default async function ComposePage({ searchParams }: { searchParams: Promise<{ brief?: string }> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const ws = ctx.workspaceId;
  const [settings, connected, layers, brief] = await Promise.all([
    db.settings.findUniqueOrThrow({ where: { workspaceId: ws } }),
    connectedTypes(ws),
    getLayers(ws),
    sp.brief
      ? db.brief.findFirst({ where: { id: sp.brief, workspaceId: ws }, include: { drafts: { include: { images: true, schedule: true }, orderBy: { createdAt: "asc" } } } })
      : db.brief.findFirst({ where: { workspaceId: ws }, orderBy: { createdAt: "desc" }, include: { drafts: { include: { images: true, schedule: true }, orderBy: { createdAt: "asc" } } } }),
  ]);

  const tiles: PlatformTile[] = await Promise.all(
    PLATFORM_LIST.map(async (p) => ({
      id: p.id,
      name: p.name,
      short: p.short,
      mono: p.mono,
      color: p.color,
      mode: p.publish.label,
      limit: p.textLimit,
      titleLabel: p.title?.label ?? null,
      titleLimit: p.title?.limit ?? null,
      subtitleLabel: p.subtitle?.label ?? null,
      subtitleLimit: p.subtitle?.limit ?? null,
      longForm: !!p.longForm,
      tagsLabel: p.hashtags.kind === "topics" ? (p.id === "blog" ? "Tags" : "Topics") : null,
      sizes: p.sizes,
      enabled: layers[p.id as PlatformId]?.enabled ?? true,
      auto: await canAuto(ws, p.id),
      copyMode: p.publish.kind === "copy" || (p.publish.kind === "token-draft" && !(await canAuto(ws, p.id))),
      firstComment: layers[p.id as PlatformId]?.rules.cta === "First comment",
    })),
  );

  const generators = [
    { id: "builtin", label: "Built-in brand templates · no setup", on: true },
    { id: "canva", label: "Canva", on: connected.has("canva") },
    { id: "figma", label: "Figma", on: connected.has("figma") },
    { id: "higgsfield", label: "Higgsfield", on: connected.has("higgsfield") },
    ...(connected.has("custom") ? [{ id: "custom", label: "Custom integration", on: true }] : []),
  ];

  return (
    <ComposeClient
      key={brief?.id ?? "new"}
      tiles={tiles}
      generators={generators}
      hasClaude={!!settings.claudeKeyEnc}
      heygen={connected.has("heygen")}
      initialImages={settings.lastImagePlatforms}
      initialGenerator={generators.find((g) => g.id === settings.lastGenerator && g.on)?.id ?? "builtin"}
      initialBrief={
        brief
          ? { id: brief.id, text: brief.text, goal: brief.goal, tone: brief.tone, subreddit: brief.subreddit, keyword: brief.keyword, postPlatforms: brief.postPlatforms, imagePlatforms: brief.imagePlatforms, createdAt: brief.createdAt.toISOString() }
          : null
      }
      initialDrafts={brief ? brief.drafts.map(draftDTO) : []}
    />
  );
}
