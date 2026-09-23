import { getCtx } from "@/lib/auth";
import { loadBrand } from "@/lib/brand";
import { BrandClient } from "@/components/brand/BrandClient";

export const dynamic = "force-dynamic";

export default async function BrandPage() {
  const ctx = (await getCtx())!;
  const brand = await loadBrand(ctx.workspaceId);
  return <BrandClient initial={brand} />;
}
