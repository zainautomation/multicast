import { redirect } from "next/navigation";
import { getCtx, ownerExists } from "@/lib/auth";
import { getStatus } from "@/lib/status";
import { ensureSeeded } from "@/lib/workspace";
import { Sidebar } from "@/components/Sidebar";
import { Providers } from "@/components/Providers";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getCtx();
  if (!ctx) redirect((await ownerExists()) ? "/login" : "/setup");
  await ensureSeeded(ctx.workspaceId);
  const status = await getStatus(ctx.workspaceId);
  return (
    <Providers>
      <div className="flex min-h-screen">
        <Sidebar status={status} email={ctx.email} />
        <main className="flex min-w-0 flex-1 flex-col gap-7 px-11 py-9">{children}</main>
      </div>
    </Providers>
  );
}
