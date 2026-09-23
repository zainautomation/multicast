import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";

export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 30 },
  pages: { signIn: "/login" },
  providers: [
    CredentialsProvider({
      name: "Email",
      credentials: { email: { label: "Email", type: "email" }, password: { label: "Password", type: "password" } },
      async authorize(creds) {
        const email = creds?.email?.toLowerCase().trim();
        if (!email || !creds?.password) return null;
        const user = await db.user.findUnique({ where: { email } });
        if (!user) return null;
        const ok = await bcrypt.compare(creds.password, user.passwordHash);
        if (!ok) return null;
        return { id: user.id, email: user.email, name: user.name, workspaceId: user.workspaceId } as never;
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) token.workspaceId = (user as unknown as { workspaceId: string }).workspaceId;
      return token;
    },
    async session({ session, token }) {
      (session as unknown as { workspaceId: string }).workspaceId = token.workspaceId as string;
      (session as unknown as { userId: string }).userId = token.sub as string;
      return session;
    },
  },
};

export type Ctx = { userId: string; workspaceId: string; email: string };

export async function getCtx(): Promise<Ctx | null> {
  const s = await getServerSession(authOptions);
  const ws = (s as unknown as { workspaceId?: string } | null)?.workspaceId;
  const uid = (s as unknown as { userId?: string } | null)?.userId;
  if (!s || !ws || !uid) return null;
  return { userId: uid, workspaceId: ws, email: s.user?.email ?? "" };
}

/**
 * For pages: the session, or a redirect to sign-in / first-run setup. Pages render in
 * parallel with the layout, so each page must guard itself rather than rely on the layout.
 */
export async function requireCtx(): Promise<Ctx> {
  const ctx = await getCtx();
  if (ctx) return ctx;
  redirect((await ownerExists()) ? "/login" : "/setup");
}

export async function ownerExists(): Promise<boolean> {
  return (await db.user.count()) > 0;
}
