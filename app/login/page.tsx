import { redirect } from "next/navigation";
import { getCtx, ownerExists } from "@/lib/auth";
import { AuthForm } from "@/components/AuthForm";
import { Providers } from "@/components/Providers";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await getCtx()) redirect("/compose");
  // No redirect to /setup here: people can always reach the sign-in form, and it links to
  // account creation while no owner exists yet.
  const canCreate = !(await ownerExists());
  return (
    <Providers>
      <AuthForm mode="login" canCreate={canCreate} />
    </Providers>
  );
}
