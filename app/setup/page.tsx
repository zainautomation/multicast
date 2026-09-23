import { redirect } from "next/navigation";
import { ownerExists } from "@/lib/auth";
import { AuthForm } from "@/components/AuthForm";
import { Providers } from "@/components/Providers";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  if (await ownerExists()) redirect("/login");
  return (
    <Providers>
      <AuthForm mode="setup" />
    </Providers>
  );
}
