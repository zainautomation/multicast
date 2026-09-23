import { requireCtx } from "@/lib/auth";
import { getLayers } from "@/lib/prompts/layers";
import { loadBrand } from "@/lib/brand";
import { BRAND_LAYER, PLATFORM_LIST } from "@/lib/platforms";
import { connectedTypes } from "@/lib/integrations/store";
import { PromptsClient, type LayerView } from "@/components/prompts/PromptsClient";

export const dynamic = "force-dynamic";

const SUB: Record<string, string> = {
  fb: "Meta",
  ig: "Meta · Business or Creator",
  lip: "Personal account",
  lic: "Company page",
  quora: "Answers & Spaces",
  medium: "Articles",
  reddit: "Per subreddit",
};

export default async function PromptsPage() {
  const ctx = await requireCtx();
  const [layers, brand, connected] = await Promise.all([getLayers(ctx.workspaceId), loadBrand(ctx.workspaceId), connectedTypes(ctx.workspaceId)]);
  const views: LayerView[] = [
    {
      id: "brand",
      name: BRAND_LAYER.name,
      sub: BRAND_LAYER.sub,
      mono: BRAND_LAYER.mono,
      color: BRAND_LAYER.color,
      specRows: [...BRAND_LAYER.specRows, { k: "Banned phrases", v: `${brand.bannedPhrases.length} words` }],
      pub: BRAND_LAYER.pub,
      sizes: [],
      textPrompt: layers.brand.textPrompt,
      imagePrompt: layers.brand.imagePrompt,
      rules: layers.brand.rules,
      imageDefaults: layers.brand.imageDefaults,
      enabled: true,
      version: layers.brand.version,
    },
    ...PLATFORM_LIST.map((p) => {
      const l = layers[p.id];
      return {
        id: p.id,
        name: p.name,
        sub: SUB[p.id],
        mono: p.mono,
        color: p.color,
        specRows: p.specRows,
        pub: p.publish.note,
        sizes: p.sizes,
        textPrompt: l.textPrompt,
        imagePrompt: l.imagePrompt,
        rules: l.rules,
        imageDefaults: l.imageDefaults,
        enabled: l.enabled,
        version: l.version,
      };
    }),
  ];
  const generators = [
    { id: "builtin", label: "Built-in templates", on: true },
    { id: "canva", label: "Canva", on: connected.has("canva") },
    { id: "figma", label: "Figma", on: connected.has("figma") },
    { id: "higgsfield", label: "Higgsfield", on: connected.has("higgsfield") },
    { id: "custom", label: "Custom integration", on: connected.has("custom") },
  ];
  return (
    <PromptsClient
      layers={views}
      backgrounds={brand.backgrounds}
      textColors={brand.textColors}
      generators={generators}
      signatures={{ company: brand.sigCompany, personal: brand.sigPersonal }}
      logoPosition={brand.logoPosition}
    />
  );
}
