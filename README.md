# Multicast

One brief in, platform-native posts (and optional brand images) out. Then publish now, schedule, or get reminded.

Platforms: Facebook Page, Instagram, LinkedIn Profile, LinkedIn Company Page, Quora, Medium, Reddit.
Built from `multicast-build-spec.md` and the approved design (six screens: Compose, Schedule, Platform prompts, Brand kit, Integrations, Claude API & accounts).

## Quick start

```bash
npm install
cp .env.example .env            # then fill in ENCRYPTION_KEY and NEXTAUTH_SECRET
npm run gen:key                 # prints a value for ENCRYPTION_KEY
docker compose up -d            # Postgres, Redis, MinIO
npm run db:deploy               # applies prisma/migrations
npm run dev                     # http://localhost:3000 → create the owner account at /setup
npm run worker                  # second terminal: scheduled posts and reminders
```

Then open **Claude API & accounts**, paste your Claude API key and press **Test connection**. That key is the only required setting. Everything else is optional.

Production: `npm run build && npm start`, plus `npm run worker` as a separate long-running process.

## What needs what

| Feature | Needs |
|---|---|
| Drafts, validation, repair, built-in brand images | Claude API key (entered in the app) |
| Schedule / reminders | `REDIS_URL` and the worker process. **Post now** works without them |
| Instagram publishing | Images at a public HTTPS URL, so configure `S3_*`. Local `./storage` is dev only |
| Auto-publishing | OAuth app credentials in `.env` (`META_*`, `LINKEDIN_*`, `REDDIT_*`), then **Connect** in the app |
| LinkedIn Company Page | Community Management API approval, then set `LINKEDIN_COMPANY_ENABLED=true` |
| Medium | An existing integration token (Medium no longer issues new ones) |
| Quora | Nothing: copy mode plus reminders only |
| Email reminders | `EMAIL_RESEND_API_KEY` or `EMAIL_SMTP_*` |
| Browser notifications | `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` (`npx web-push generate-vapid-keys`) |
| Canva, Figma, Higgsfield, HeyGen, custom webhook, Slack | Credentials entered on the Integrations screen |

OAuth redirect URLs to register with each provider: `{APP_URL}/api/oauth/{meta|linkedin|reddit|canva}/callback`.
Slack interactivity URL: `{APP_URL}/api/slack/actions` (bot-token mode, signing secret required).

## How generation works

For each selected platform, Multicast makes one Claude request, four at a time, streamed to the UI card by card:

- **System prompt:** brand voice → platform prompt (variables filled in) → **HARD LIMITS** block built from `lib/platforms.ts` → output rules → banned phrases.
- **Structured output:** Claude answers through a `return_draft` tool. How the tool call is enforced depends on the model, because the current models differ (`lib/models.ts`):
  - Haiku 4.5: forced `tool_choice` plus temperature (the Creativity setting)
  - Sonnet 5: forced `tool_choice` with thinking disabled; it does not accept `temperature`
  - Opus 5.5: `tool_choice: auto` plus a `strict` schema and an explicit instruction; it rejects forced tool choice and `temperature`, so Creativity has no effect on it
- **Validation in code** (`lib/generation/validate.ts`): length, hashtag caps (Instagram ≤ 5, plus your hashtag rule), required titles, banned phrases, and no links where the rule says "first comment" or "link in bio". A failing draft gets one repair call to the checker model. If it still fails, Approve stays blocked until you edit it.
- **Usage:** every call is recorded (model, tokens, estimated cost, prompt version). The monthly spend cap is enforced on the server.
- **Images:** Claude writes only the on-image text and picks a layout (`return_image_spec`). Satori and resvg render the image at the exact pixel size with your brand colours, fonts, logo variant and signature. Text/background contrast is enforced: 4.5:1 for body text, 3:1 for large text, falling back to the best kit colour and noting it on the card. Instagram images are JPEG. External tools fall back to the built-in renderer if they fail.

## Project layout

```
app/(app)/*              the six screens (server pages + client components in components/)
app/api/*                route handlers (session + same-origin CSRF check in lib/api.ts)
lib/platforms.ts         platform limits, sizes, publish modes: single source of truth
lib/models.ts            model IDs, prices, per-model request capabilities
lib/prompts/*            seed prompts, assembly, versioned layers (last 20 kept)
lib/generation/*         text + image pipeline, validators, orchestration
lib/render/*             Satori templates, fonts, layout maths
lib/publishers/*         Meta (FB + IG), LinkedIn, Reddit, Medium adapters + token refresh
lib/integrations/*       Canva, Figma, Higgsfield, HeyGen, custom webhook, credential store
lib/notify/*             Slack (bot / webhook), email, web push
lib/schedule/*           time zones, suggestion algorithm, BullMQ queue, scheduling service
worker/index.ts          BullMQ worker: publish (retries 1/5/15 min), remind, daily reconcile, weekly summary
```

## Security

- API keys and OAuth tokens (including Meta Page tokens) use AES-256-GCM envelope encryption, with a unique IV and data key per value. They never go back to the browser; the UI only sees the last 4 characters.
- All third-party calls run server-side.
- Mutations require a same-origin request. OAuth `state` (plus PKCE for Canva) is checked, and Slack requests are signature-verified.
- Uploads are type-checked by content, size-capped (logos ≤ 5 MB), and SVGs are sanitised.
- Generation endpoints are rate-limited.

## Tests

```bash
npm test          # validators, prompt assembly, contrast, suggestions/time zones, crypto, real renders
npm run typecheck
```

## Before release: [verify]

Third-party APIs move. Re-check these against current docs: Meta Graph version and scopes, the Instagram hashtag cap and publishing limit, `LinkedIn-Version`, Reddit media upload, Canva autofill (may need Enterprise), Higgsfield endpoints (base URL and model are configurable in the integration's meta), and HeyGen endpoints.

Out of scope for v1: analytics, inbox/replies, multi-user roles, TikTok/X/Threads/YouTube. Adding a platform means a new entry in `lib/platforms.ts` plus a publisher.
