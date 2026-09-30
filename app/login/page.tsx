import { redirect } from "next/navigation";
import { getCtx, ownerExists } from "@/lib/auth";
import { AuthForm } from "@/components/AuthForm";
import { Providers } from "@/components/Providers";

export const dynamic = "force-dynamic";

/** Only same-site paths, so ?next= can't send someone to another site after sign-in. */
const safeNext = (n?: string) => (n && n.startsWith("/") && !n.startsWith("//") && !n.startsWith("/\\") ? n : null);

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNext((await searchParams).next);
  if (await getCtx()) redirect(next ?? "/compose");
  // No redirect to /setup here: people can always reach the sign-in form, and it links to
  // account creation while no owner exists yet.
  const canCreate = !(await ownerExists());
  return (
    <Providers>
      <AuthForm mode="login" canCreate={canCreate} next={next} />
    </Providers>
  );
}
