// Create the single owner account from the command line:
//   npm run setup:owner -- you@example.com "a long password" "Your Name"
import bcrypt from "bcryptjs";
import { db } from "../lib/db";
import { createWorkspaceWithOwner } from "../lib/workspace";

async function main() {
  const [email, password, name] = process.argv.slice(2);
  if (!email || !password) {
    console.error('Usage: npm run setup:owner -- <email> "<password>" ["Name"]');
    process.exit(1);
  }
  if (password.length < 10) throw new Error("Use a password of at least 10 characters");
  if (await db.user.count()) throw new Error("An owner already exists. Multicast v1 is single-owner.");
  const ws = await createWorkspaceWithOwner(email, await bcrypt.hash(password, 12), name);
  console.log(`Owner ${email} created (workspace ${ws.id}). Sign in at ${process.env.APP_URL ?? "http://localhost:3000"}/login`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
