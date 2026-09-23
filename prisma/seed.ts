// Seeds prompt layers, brand kit, posting windows and settings for every workspace.
// The owner account itself is created on first visit (/setup) or with `npm run setup:owner`.
import { db } from "../lib/db";
import { ensureSeeded } from "../lib/workspace";

async function main() {
  const workspaces = await db.workspace.findMany({ select: { id: true, name: true } });
  if (!workspaces.length) {
    console.log("No workspace yet. Open the app and create the owner account at /setup, or run: npm run setup:owner");
    return;
  }
  for (const w of workspaces) {
    await ensureSeeded(w.id);
    console.log(`Seeded ${w.name} (${w.id})`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
