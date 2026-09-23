"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, Button, cx, inputMutedCls, PageHeader, Pill, useToast } from "@/components/ui";

export type ToolView = { status: "off" | "connected" | "pending" | "error"; last4: string | null; verifiedAt: string | null; meta: Record<string, unknown> };

type ToolId = "canva" | "figma" | "higgsfield" | "heygen" | "custom";
type FieldDef = { id: string; label: string; type: "text" | "password" | "url"; ph: string; optional?: boolean; meta?: boolean };

const TOOLS: { id: ToolId; name: string; kind: string; mono: string; color: string; docs: string; desc: string; uses: string[]; fields: FieldDef[]; prefix: string }[] = [
  {
    id: "canva",
    name: "Canva",
    kind: "Design templates · Canva Connect API",
    mono: "Cv",
    color: "#1F6F78",
    docs: "https://www.canva.dev/docs/connect/",
    desc: "Fills your brand templates with the post copy to produce feed images, carousels and link-preview graphics, then attaches the export to the draft.",
    uses: ["Instagram carousel", "Facebook image", "LinkedIn image"],
    fields: [
      { id: "clientId", label: "Client ID", type: "text", ph: "OC-xxxxxxxxxxxx" },
      { id: "clientSecret", label: "Client secret", type: "password", ph: "••••••••••••" },
      { id: "defaultBrandTemplateId", label: "Brand template ID (optional)", type: "text", ph: "Autofill may need Canva Enterprise", optional: true, meta: true },
    ],
    prefix: "OC-",
  },
  {
    id: "figma",
    name: "Figma",
    kind: "Design files · REST API",
    mono: "Fg",
    color: "#5B3F8C",
    docs: "https://www.figma.com/developers/api",
    desc: "Exports frames from a Figma file you choose as PNG backgrounds sized for each platform; the headline is set on top by the built-in renderer.",
    uses: ["Branded frames", "Export PNG / JPG", "Headline overlays"],
    fields: [
      { id: "token", label: "Personal access token", type: "password", ph: "figd_••••••••" },
      { id: "fileKey", label: "Template file key (optional)", type: "text", ph: "e.g. aB12cD34eF", optional: true },
    ],
    prefix: "figd_",
  },
  {
    id: "higgsfield",
    name: "Higgsfield",
    kind: "AI image & video generation",
    mono: "Hf",
    color: "#7A4A1C",
    docs: "https://higgsfield.ai",
    desc: "Generates stylised images from a visual brief, for Reels, Stories and eye-catching feed posts. Brand text is overlaid by the built-in renderer.",
    uses: ["Instagram Reel", "Story background", "Hero image"],
    fields: [
      { id: "apiKey", label: "API key", type: "password", ph: "••••••••••••" },
      { id: "apiSecret", label: "API secret", type: "password", ph: "••••••••••••" },
    ],
    prefix: "hf_",
  },
  {
    id: "heygen",
    name: "HeyGen",
    kind: "AI avatar video",
    mono: "Hg",
    color: "#2F5D3A",
    docs: "https://docs.heygen.com",
    desc: "Turns a post into a short talking-avatar video script and renders it with your chosen avatar and voice.",
    uses: ["LinkedIn video", "Reel explainer", "Facebook video"],
    fields: [
      { id: "apiKey", label: "API key", type: "password", ph: "••••••••••••" },
      { id: "avatarId", label: "Default avatar ID (optional)", type: "text", ph: "e.g. avatar_123", optional: true },
    ],
    prefix: "",
  },
];

const CUSTOM = {
  id: "custom" as const,
  name: "Custom integration",
  kind: "Webhook · image spec in, image URL out",
  mono: "+",
  color: "#4F4B43",
  docs: "",
  desc: "Multicast POSTs the image spec as JSON (platform, width, height, slides, colours) to your webhook and expects { \"url\": \"https://…\" } or { \"urls\": [...] } back.",
  uses: ["Any image generator", "Internal design service"],
  fields: [
    { id: "webhookUrl", label: "Webhook URL", type: "url", ph: "https://example.com/render" },
    { id: "apiKey", label: "API key (sent as Bearer, optional)", type: "password", ph: "••••••••", optional: true },
  ] as FieldDef[],
  prefix: "",
};

const EVENTS = [
  { id: "ready", label: "Drafts are ready (full content)" },
  { id: "published", label: "A post goes live (with link)" },
  { id: "failed", label: "A post fails or is rejected" },
  { id: "visual", label: "A draft needs a visual" },
  { id: "weekly", label: "Weekly summary of posts" },
];

function ToolCard({ t, view, onDone, appUrl }: { t: (typeof TOOLS)[number] | typeof CUSTOM; view: ToolView; onDone: () => void; appUrl: string }) {
  const toast = useToast();
  const [vals, setVals] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [verified, setVerified] = useState<string | null>(view.verifiedAt);
  const [tplId, setTplId] = useState(String(view.meta.defaultBrandTemplateId ?? ""));
  const on = view.status === "connected";

  async function connect() {
    setBusy("connect");
    try {
      const creds: Record<string, string> = {};
      const meta: Record<string, string> = {};
      for (const f of t.fields) if (vals[f.id]) (f.meta ? meta : creds)[f.id] = vals[f.id].trim();
      const r = await api<{ redirect?: string }>(`/api/integrations/${t.id}`, { method: "POST", json: { creds, meta } });
      if (r.redirect) {
        window.location.href = r.redirect;
        return;
      }
      toast(`${t.name} connected`, "ok");
      setVals({});
      onDone();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(null);
    }
  }

  async function test() {
    setBusy("test");
    try {
      const r = await api<{ verifiedAt: string }>(`/api/integrations/${t.id}/test`, { method: "POST" });
      setVerified(r.verifiedAt);
      toast(`${t.name}: connection works`, "ok");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(null);
    }
  }

  async function disconnect() {
    if (!confirm(`Disconnect ${t.name}? Its saved credentials are deleted.`)) return;
    await api(`/api/integrations/${t.id}`, { method: "DELETE" });
    onDone();
  }

  async function saveTemplate() {
    await api(`/api/integrations/canva`, { method: "PATCH", json: { defaultBrandTemplateId: tplId } });
    toast("Brand template saved", "ok");
  }

  const required = t.fields.filter((f) => !f.optional);
  const ready = required.every((f) => (vals[f.id] ?? "").trim().length > 2);
  const ago = (iso: string | null) => {
    if (!iso) return "Saved";
    const m = Math.round((Date.now() - +new Date(iso)) / 60000);
    return m < 1 ? "Verified just now" : m < 60 ? `Verified ${m} min ago` : `Verified ${new Date(iso).toLocaleDateString()}`;
  };

  return (
    <article className={cx("flex flex-col gap-4 rounded-[16px] border bg-surface p-6", on ? "border-success-line" : "border-line")}>
      <div className="flex items-center gap-3.5">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[11px] text-[15px] font-semibold text-white" style={{ background: t.color }} aria-hidden="true">
          {t.mono}
        </span>
        <div className="flex flex-1 flex-col gap-0.5">
          <h2 className="m-0 font-display text-[22px] font-medium">{t.name}</h2>
          <span className="text-[13px] text-caption">{t.kind}</span>
        </div>
        <Pill kind={on ? "solid" : view.status === "pending" ? "warn" : "none"}>{on ? "Connected" : view.status === "pending" ? "Finish sign-in" : "Optional"}</Pill>
      </div>
      <p className="m-0 text-sm leading-[1.55] text-[#3A3731]">{t.desc}</p>
      <div className="flex flex-wrap gap-1.5">
        {t.uses.map((u) => (
          <span key={u} className="rounded-[14px] bg-bg px-2.5 py-[5px] text-xs text-muted">
            {u}
          </span>
        ))}
      </div>
      {!on ? (
        <div className="flex flex-col gap-3">
          {t.fields.map((f) => (
            <div key={f.id} className="flex flex-col gap-1.5">
              <label htmlFor={`${t.id}-${f.id}`} className="text-[13px] font-semibold">
                {f.label}
              </label>
              <input
                id={`${t.id}-${f.id}`}
                type={f.type}
                autoComplete="off"
                spellCheck={false}
                placeholder={f.ph}
                value={vals[f.id] ?? ""}
                onChange={(e) => setVals((v) => ({ ...v, [f.id]: e.target.value }))}
                className={inputMutedCls + " font-mono text-[13px]"}
              />
            </div>
          ))}
          {t.id === "canva" ? (
            <span className="text-xs leading-snug text-caption">
              In the Canva developer portal, set the redirect URL to <code className="font-mono">{appUrl}/api/oauth/canva/callback</code> (Canva requires 127.0.0.1 rather than localhost for local development).
            </span>
          ) : null}
          <div className="flex flex-wrap items-center gap-2.5">
            {view.status === "pending" ? (
              <a href="/api/oauth/canva/start" className="inline-flex min-h-11 items-center rounded-[10px] bg-ink px-5 text-sm font-semibold !text-white no-underline">
                Continue Canva sign-in
              </a>
            ) : null}
            <Button variant="dark" className="px-5" onClick={connect} busy={busy === "connect"} disabled={!ready}>
              Connect
            </Button>
            {t.docs ? (
              <a href={t.docs} target="_blank" rel="noreferrer" className="text-[13.5px]">
                Where do I find this?
              </a>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between rounded-[10px] bg-[#EEF5F0] px-3.5 py-3">
            <span className="font-mono text-[13px] text-success-text">
              {t.prefix}••••••••{view.last4 ?? ""}
            </span>
            <span className="text-[12.5px] text-success-text">{ago(verified)}</span>
          </div>
          {t.id === "canva" ? (
            <div className="flex items-end gap-2">
              <div className="flex flex-1 flex-col gap-1.5">
                <label htmlFor="canva-tpl" className="text-[13px] font-semibold">
                  Brand template ID (optional)
                </label>
                <input id="canva-tpl" className={inputMutedCls + " font-mono text-[13px]"} value={tplId} onChange={(e) => setTplId(e.target.value)} placeholder="Fields: headline, subline, items" />
              </div>
              <Button onClick={saveTemplate}>Save</Button>
            </div>
          ) : null}
          {t.id === "figma" && view.meta.fileKey ? <span className="text-[12.5px] text-muted">Template file: <code className="font-mono">{String(view.meta.fileKey)}</code></span> : null}
          <div className="flex gap-2.5">
            <Button onClick={test} busy={busy === "test"}>
              Test connection
            </Button>
            <Button variant="danger" onClick={disconnect}>
              Disconnect
            </Button>
          </div>
        </div>
      )}
    </article>
  );
}

export function IntegrationsClient({
  tools,
  slack,
  events: initialEvents,
  flash,
  appUrl,
}: {
  tools: Record<ToolId, ToolView>;
  slack: ToolView;
  events: string[];
  flash: { connected: string | null; error: string | null };
  appUrl: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [showCustom, setShowCustom] = useState(tools.custom.status !== "off");
  const [method, setMethod] = useState<"bot" | "hook">((slack.meta.method as "bot" | "hook") ?? "bot");
  const [cred, setCred] = useState("");
  const [secret, setSecret] = useState("");
  const [channel, setChannel] = useState(String(slack.meta.channel ?? "#social-drafts"));
  const [events, setEvents] = useState(new Set(initialEvents));
  const [busy, setBusy] = useState<string | null>(null);
  const slackOn = slack.status === "connected";
  const connectedCount = (["canva", "figma", "higgsfield", "heygen"] as const).filter((k) => tools[k].status === "connected").length;

  useEffect(() => {
    if (flash.connected) toast(`${flash.connected[0].toUpperCase()}${flash.connected.slice(1)} connected`, "ok");
    if (flash.error) toast(flash.error, "error");
    if (flash.connected || flash.error) router.replace("/integrations");
  }, [flash.connected, flash.error]); // eslint-disable-line react-hooks/exhaustive-deps

  async function saveEvents(next: Set<string>) {
    setEvents(next);
    try {
      await api("/api/notifications", { method: "PUT", json: { events: [...next] } });
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  async function connectSlack() {
    setBusy("slack");
    try {
      await api("/api/integrations/slack", {
        method: "POST",
        json: { creds: method === "bot" ? { botToken: cred, signingSecret: secret } : { webhookUrl: cred }, meta: { method, channel } },
      });
      setCred("");
      setSecret("");
      toast("Slack connected", "ok");
      router.refresh();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(null);
    }
  }

  async function disconnectSlack() {
    if (!confirm("Disconnect Slack?")) return;
    await api("/api/integrations/slack", { method: "DELETE" });
    router.refresh();
  }

  async function testMessage() {
    setBusy("msg");
    try {
      await api("/api/integrations/slack/message", { method: "POST" });
      toast("Test message sent", "ok");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(null);
    }
  }

  const bot = method === "bot";

  return (
    <>
      <PageHeader
        eyebrow="Integrations"
        title="Creative tools, when you need them."
        intro="None of these are required. Text posts work without them. When a draft needs a visual or video, the agent offers whichever tools you have connected."
        actions={<span className="whitespace-nowrap rounded-[20px] border border-line bg-surface px-3.5 py-2 text-[13px] text-muted">{connectedCount} of 4 connected · all optional</span>}
      />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        {TOOLS.map((t) => (
          <ToolCard key={t.id} t={t} view={tools[t.id]} onDone={() => router.refresh()} appUrl={appUrl} />
        ))}
        {showCustom ? <ToolCard t={CUSTOM} view={tools.custom} onDone={() => router.refresh()} appUrl={appUrl} /> : null}
      </div>

      <section aria-label="Notifications" className="flex flex-col gap-3.5">
        <div className="flex items-baseline justify-between">
          <h2 className="m-0 font-display text-[26px] font-medium">Notifications</h2>
          <span className="text-[13px] text-caption">Optional · get drafts and results where you already work</span>
        </div>
        <article className={cx("flex flex-wrap gap-7 rounded-[16px] border bg-surface p-6", slackOn ? "border-success-line" : "border-line")}>
          <div className="flex min-w-[420px] flex-1 flex-col gap-4">
            <div className="flex items-center gap-3.5">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[11px] bg-[#4A1D4F] text-[15px] font-semibold text-white" aria-hidden="true">
                Sl
              </span>
              <div className="flex flex-1 flex-col gap-0.5">
                <h3 className="m-0 font-display text-[22px] font-medium">Slack</h3>
                <span className="text-[13px] text-caption">Messages with the full post content · Slack API</span>
              </div>
              <Pill kind={slackOn ? "solid" : "none"}>{slackOn ? "Connected" : "Optional"}</Pill>
            </div>

            <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
              <legend className="mb-2 p-0 text-[13px] font-semibold">Connection method</legend>
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    ["bot", "Bot token", "Full content plus Approve and Regenerate buttons in Slack"],
                    ["hook", "Incoming webhook", "Quick setup, one channel, notifications only"],
                  ] as const
                ).map(([id, name, sub]) => (
                  <label key={id} className={cx("flex cursor-pointer items-start gap-2.5 rounded-[10px] border p-3", method === id ? "border-accent bg-accent-soft" : "border-line bg-surface")}>
                    <input type="radio" name="slackmethod" checked={method === id} onChange={() => setMethod(id)} className="mt-0.5 h-[18px] w-[18px] shrink-0 accent-accent" />
                    <span className="flex flex-col gap-0.5">
                      <span className="text-[13.5px] font-medium">{name}</span>
                      <span className="text-xs leading-snug text-caption">{sub}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="grid grid-cols-2 gap-3.5">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="sl1" className="text-[13px] font-semibold">
                  {bot ? "Bot token" : "Webhook URL"}
                </label>
                <input
                  id="sl1"
                  type="password"
                  autoComplete="off"
                  value={cred}
                  onChange={(e) => setCred(e.target.value)}
                  placeholder={slackOn && slack.last4 ? `••••••••${slack.last4} (saved)` : bot ? "xoxb-••••••••••••" : "https://hooks.slack.com/services/…"}
                  className={inputMutedCls + " font-mono text-[13px]"}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="sl2" className="text-[13px] font-semibold">
                  Channel or DM
                </label>
                <input id="sl2" type="text" value={channel} onChange={(e) => setChannel(e.target.value)} disabled={!bot} className={inputMutedCls + " font-mono text-[13px]"} />
              </div>
              {bot ? (
                <div className="col-span-2 flex flex-col gap-1.5">
                  <label htmlFor="sl3" className="text-[13px] font-semibold">
                    Signing secret
                  </label>
                  <input id="sl3" type="password" autoComplete="off" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder={slackOn ? "•••••••• (saved)" : "From Basic Information → App Credentials"} className={inputMutedCls + " font-mono text-[13px]"} />
                  <span className="text-xs text-caption">
                    Interactivity request URL: <code className="font-mono">{appUrl}/api/slack/actions</code>
                  </span>
                </div>
              ) : null}
            </div>

            <fieldset className="m-0 border-0 p-0">
              <legend className="mb-2 p-0 text-[13px] font-semibold">Notify me when</legend>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                {EVENTS.map((e) => (
                  <label key={e.id} className="flex min-h-10 cursor-pointer items-center gap-2.5 text-[13.5px]">
                    <input
                      type="checkbox"
                      checked={events.has(e.id)}
                      onChange={() => {
                        const n = new Set(events);
                        if (n.has(e.id)) n.delete(e.id);
                        else n.add(e.id);
                        saveEvents(n);
                      }}
                      className="h-[18px] w-[18px] shrink-0 accent-accent"
                    />
                    {e.label}
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="flex flex-wrap items-center gap-2.5 pt-1">
              {slackOn ? (
                <>
                  <Button variant="dark" onClick={connectSlack} busy={busy === "slack"}>
                    Save changes
                  </Button>
                  <Button variant="danger" onClick={disconnectSlack}>
                    Disconnect
                  </Button>
                </>
              ) : (
                <Button variant="dark" className="px-5" onClick={connectSlack} busy={busy === "slack"} disabled={!cred || (bot && !secret)}>
                  Connect Slack
                </Button>
              )}
              <Button onClick={testMessage} busy={busy === "msg"} disabled={!slackOn}>
                Send test message
              </Button>
              <a href="https://api.slack.com/apps" target="_blank" rel="noreferrer" className="ml-1.5 text-[13.5px]">
                Create a Slack app
              </a>
            </div>
          </div>

          <div className="flex w-[420px] shrink-0 flex-col gap-2.5">
            <span className="text-xs uppercase tracking-[0.06em] text-caption">Message preview</span>
            <div className="flex gap-3 rounded-xl border border-line bg-surface-muted p-4">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent font-display font-semibold text-white" aria-hidden="true">
                M
              </span>
              <div className="flex min-w-0 flex-col gap-2">
                <div className="flex items-baseline gap-2">
                  <span className="text-sm font-semibold">Multicast</span>
                  <span className="rounded-[3px] bg-divider px-[5px] py-px text-[11px] text-muted">APP</span>
                </div>
                <span className="text-[13.5px] leading-normal">5 drafts are ready for review: Facebook, Instagram, LinkedIn Profile, LinkedIn Company, Reddit.</span>
                <div className="flex flex-col gap-1 rounded-lg border border-line bg-surface px-3 py-2.5">
                  <span className="text-[13px] font-semibold">LinkedIn Profile draft</span>
                  <span className="whitespace-pre-line text-[13px] leading-normal text-ink-soft">{"Most founders make the same mistake with their first international hire: they treat it like a domestic one.\n\nDifferent country, different rules. Contracts, notice periods, tax, benefits."}</span>
                  <span className="text-[12.5px] text-muted">…full text included</span>
                </div>
                {bot ? (
                  <div className="flex flex-wrap gap-2">
                    <span className="rounded-md bg-success px-3 py-1.5 text-[12.5px] font-semibold text-white">Approve &amp; post</span>
                    <span className="rounded-md border border-input bg-surface px-3 py-1.5 text-[12.5px]">Regenerate</span>
                    <span className="rounded-md border border-input bg-surface px-3 py-1.5 text-[12.5px]">Open in Multicast</span>
                  </div>
                ) : (
                  <span className="text-[12.5px] text-accent">Open in Multicast to approve</span>
                )}
              </div>
            </div>
            <span className="text-[12.5px] leading-normal text-caption">{bot ? "Needs scopes chat:write and interactivity enabled so buttons can approve posts from Slack." : "Webhooks can only post to the one channel chosen when the webhook was created."}</span>
          </div>
        </article>
      </section>

      {!showCustom ? (
        <div className="flex items-center gap-4 rounded-[14px] border border-dashed border-dash px-[22px] py-[18px]">
          <div className="flex flex-1 flex-col gap-[3px]">
            <span className="text-[14.5px] font-semibold">Add another tool</span>
            <span className="text-[13.5px] text-muted">Any service with an API key or webhook, such as an image generator or a scheduler.</span>
          </div>
          <Button onClick={() => setShowCustom(true)}>+ Custom integration</Button>
        </div>
      ) : null}
    </>
  );
}
