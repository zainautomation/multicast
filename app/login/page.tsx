import { redirect } from "next/navigation";
import { getCtx, ownerExists } from "@/lib/auth";
import { AuthForm } from "@/components/AuthForm";
import { Providers } from "@/components/Providers";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await getCtx()) redirect("/compose");
  if (!(await ownerExists())) redirect("/setup");
  return (
    <Providers>
      <AuthForm mode="login" />
    </Providers>
  );
}
