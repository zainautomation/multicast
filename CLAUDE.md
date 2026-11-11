# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## What this is

Multicast: a single-owner Next.js 16 (App Router) app. One brief goes in. Out come platform-native drafts (fb, ig, x, lip, lic, quora, medium, blog, reddit) and optional brand images, generated with Claude. Drafts can be published now, scheduled, or turned into reminders. The app is also an MCP server at `/api/mcp`. README.md has the full feature/env matrix, the Vercel deploy steps and the security model.

## Commands

```bash
docker compose up -d        # local Postgres, Redis, MinIO
npm run db:deploy           # apply prisma/migrations (db:migrate to create a new migration)
npm run dev                 # app on :3000; first run → create owner at /setup
npm run worker:dev          # BullMQ worker (only for the Redis scheduler backend)
npm test                    # vitest, tests/**/*.test.ts
npx vitest run tests/x.test.ts            # single file
npx vitest run -t "hashtag"               # tests matching a name
npm run typecheck           # tsc --noEmit (there is no lint script)
npm run gen:key             # value for ENCRYPTION_KEY
```

Node >= 22.9. `postinstall` runs `prisma generate`. Scripts load `.env` via `tsx --env-file-if-exists`. The `@/` import alias points to the repo root.

## Architecture

**Thin routes, shared services.** `app/api/**/route.ts` handlers are wrapped in `route()` from `lib/api.ts`. The wrapper handles the session (`getCtx()` → `{ userId, workspaceId }`), the same-origin CSRF check, and mapping `HttpError`/`ZodError` to JSON. Request bodies are parsed with `body(req, zodSchema)`. Business logic lives in `lib/`, takes `workspaceId` as its first argument, and is reused by the UI routes, the MCP tools (`lib/mcp/server.ts`) and the scheduler. Examples: `lib/drafts.ts` (`ownedDraft`, `approveDraft`, `editDraft`, …), `lib/briefs.ts`, `lib/generation/run.ts`, `lib/schedule/service.ts`, `lib/publishers/index.ts`. When behaviour changes, change it in the service so every entry point picks it up. Always scope queries by `workspaceId`.

**`lib/platforms.ts` is the single source of truth** for each platform's limits, image sizes, title/subtitle rules and publish mode. The prompt HARD LIMITS block, the validators, the UI and the publishers all read from it. Adding a platform means: an entry there, default prompts/rules in `lib/prompts/defaults.ts`, a publisher in `lib/publishers/` (or copy/reminder mode), and tests. See the X and Blog commits for worked examples. `tests/core.test.ts` asserts the platform count.

**Generation pipeline** (`lib/generation/`): one Claude call per platform, four at a time, streamed to the UI. The system prompt is assembled in `lib/prompts/assemble.ts` from these layers: brand voice → platform layer → hard limits → output rules → banned phrases. Prompt layers are versioned per workspace in the DB (last 20 kept) and seeded lazily by `ensureSeeded()` in `lib/workspace.ts`. Output comes back through a `return_draft` tool (`lib/claude.ts` `callTool`). How tool use is enforced differs per model, and `lib/models.ts` defines it: forced `tool_choice`, `temperature` support, strict schemas. Check that file before changing request params. `coerce.ts` normalises the model output and `validate.ts` checks it. A failing draft gets one repair call. Every call is recorded through `lib/usage.ts`, and the server enforces the monthly spend cap.

**Images** (`lib/render/`): Claude only writes the on-image text and picks a layout (`return_image_spec`). Satori + resvg render at exact pixel sizes with brand-kit fonts and colours. Contrast is enforced by `lib/contrast.ts`. External tools (Canva, Figma, Higgsfield, HeyGen in `lib/integrations/`) fall back to this renderer.

**Scheduling has two interchangeable backends** (`lib/schedule/queue.ts` `backend()`):
- QStash, used when `QSTASH_TOKEN` is set (Vercel): QStash calls `app/api/jobs/route.ts`, which verifies the signature.
- BullMQ on `REDIS_URL`, run by `worker/index.ts`.

Both dispatch to the same functions in `lib/schedule/jobs.ts` (`attemptPublish`, `sendReminder`, `runWeekly`) and `reconcile()`. Both use the 1/5/15-minute retry backoff in `RETRY_DELAYS_MS`. Keep the two paths in sync. Time zone maths lives in `lib/schedule/time.ts`, and suggested posting times in `suggest.ts`.

**Publishing** (`lib/publishers/`): there is one adapter per network, plus OAuth token refresh in `accounts.ts`. `lib/oauth.ts` handles OAuth2 and `lib/oauth1.ts` handles X. Only approved drafts with no blocking issues publish. Platforms with no connected account fall back to reminders.

**Secrets**: API keys and OAuth tokens are envelope-encrypted with `lib/crypto.ts` (needs `ENCRYPTION_KEY`) and never sent to the client. The UI only sees the last 4 characters. MCP/API tokens are stored as SHA-256 hashes (`lib/tokens.ts`). The MCP OAuth 2.1 flow (DCR + PKCE) is in `app/api/mcp-oauth/*`, `app/.well-known/*` and `lib/mcp/`.

**Storage** (`lib/storage.ts`): uploads go to S3/MinIO (`S3_*`), Vercel Blob (`BLOB_READ_WRITE_TOKEN`) or local `./storage` (dev only). Instagram needs public HTTPS image URLs.

**UI**: `app/(app)/*/page.tsx` are server pages that render one client component each, from `components/<screen>/*Client.tsx`. Shared primitives live in `components/ui.tsx`. Client-facing shapes are in `lib/dto.ts`. Styling is Tailwind v4.

## Conventions

- Platform numbers, API versions and endpoints marked `[verify]` must be checked against current third-party docs. Don't change them from memory.
- Schema changes need a new folder under `prisma/migrations/` (`npm run db:migrate`). Vercel deploys apply them through `vercel-build`.
