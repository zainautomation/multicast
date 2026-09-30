"use client";

import { useState } from "react";
import { api, Button, Card, inputCls, Pill, useToast } from "@/components/ui";

export type TokenRow = { id: string; kind: string; name: string; hint: string; createdAt: string; lastUsedAt: string | null };

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "never");

/** Claude API & accounts → External access: the MCP endpoint, API keys, connected apps. */
export function ExternalAccess({ mcpUrl, initial }: { mcpUrl: string; initial: TokenRow[] }) {
  const toast = useToast();
  const [tokens, setTokens] = useState(initial);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [fresh, setFresh] = useState<{ name: string; secret: string } | null>(null);

  async function reload() {
    const r = await api<{ tokens: TokenRow[] }>("/api/access-tokens");
    setTokens(r.tokens);
  }

  async function create() {
    setBusy("create");
    try {
      const r = await api<{ id: string; secret: string }>("/api/access-tokens", { method: "POST", json: { name } });
      setFresh({ name, secret: r.secret });
      setName("");
      await reload();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(null);
    }
  }

  async function revoke(t: TokenRow) {
    if (!confirm(t.kind === "key" ? `Revoke the key "${t.name}"? Anything using it stops working.` : `Disconnect ${t.name}? It will need to connect again.`)) return;
    setBusy(t.id);
    try {
      await api(`/api/access-tokens/${t.id}`, { method: "DELETE" });
      await reload();
    } finally {
      setBusy(null);
    }
  }

  function copy(text: string, what: string) {
    navigator.clipboard.writeText(text).then(
      () => toast(`${what} copied`, "ok"),
      () => toast("Copy failed; select the text instead", "error"),
    );
  }

  const keys = tokens.filter((t) => t.kind === "key");
  const apps = tokens.filter((t) => t.kind === "oauth");
  const claudeCode = `claude mcp add --transport http multicast ${mcpUrl} --header "Authorization: Bearer ${fresh?.secret ?? "YOUR_API_KEY"}"`;

  return (
    <Card aria-label="External access" className="mt-6 flex flex-col gap-4 p-[26px]">
      <div className="flex flex-col gap-1">
        <h2 className="m-0 font-display text-2xl font-medium">External access (MCP)</h2>
        <p className="m-0 text-[13.5px] leading-normal text-muted">
          Let Claude or another MCP client write, read, approve, publish and schedule posts here. It follows the same rules as the app: only approved posts go out.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-[13.5px] font-semibold">Server URL</span>
        <div className="flex gap-2">
          <input readOnly value={mcpUrl} className={inputCls + " min-w-0 flex-1 font-mono text-[13px]"} onFocus={(e) => e.target.select()} aria-label="MCP server URL" />
          <Button onClick={() => copy(mcpUrl, "URL")}>Copy</Button>
        </div>
        <span className="text-[12.5px] text-caption">
          <b>Claude (web, desktop, mobile):</b> Settings → Connectors → Add custom connector, paste this URL, then Connect and Allow. No key needed.
        </span>
      </div>

      <div className="flex flex-col gap-2 border-t border-divider pt-4">
        <span className="text-[13.5px] font-semibold">API keys</span>
        <span className="text-[12.5px] text-caption">For Claude Code, scripts and tools that send a header. Each key has full access to this workspace.</span>
        <div className="flex gap-2">
          <input className={inputCls + " min-w-0 flex-1"} value={name} onChange={(e) => setName(e.target.value)} placeholder="Key name, e.g. Claude Code on laptop" aria-label="New key name" onKeyDown={(e) => e.key === "Enter" && name.trim() && create()} />
          <Button variant="dark" onClick={create} busy={busy === "create"} disabled={!name.trim()}>
            Create key
          </Button>
        </div>
        {fresh ? (
          <div role="status" className="flex flex-col gap-2 rounded-xl bg-bg p-4 text-[13px]">
            <span className="font-semibold">Copy &ldquo;{fresh.name}&rdquo; now. It won&apos;t be shown again.</span>
            <div className="flex gap-2">
              <input readOnly value={fresh.secret} className={inputCls + " min-w-0 flex-1 font-mono text-[12.5px]"} onFocus={(e) => e.target.select()} aria-label="New API key" />
              <Button onClick={() => copy(fresh.secret, "Key")}>Copy</Button>
            </div>
            <span className="text-caption">Add to Claude Code:</span>
            <div className="flex gap-2">
              <code className="min-w-0 flex-1 break-all rounded-lg bg-surface p-2.5 font-mono text-[12px]">{claudeCode}</code>
              <Button onClick={() => copy(claudeCode, "Command")}>Copy</Button>
            </div>
            <button type="button" className="self-start cursor-pointer border-0 bg-transparent p-0 text-[12.5px] text-caption underline" onClick={() => setFresh(null)}>
              Done
            </button>
          </div>
        ) : null}
        {keys.map((t) => (
          <TokenLine key={t.id} t={t} busy={busy === t.id} onRevoke={() => revoke(t)} action="Revoke" />
        ))}
      </div>

      <div className="flex flex-col gap-2 border-t border-divider pt-4">
        <span className="text-[13.5px] font-semibold">Connected apps</span>
        {apps.length ? apps.map((t) => <TokenLine key={t.id} t={t} busy={busy === t.id} onRevoke={() => revoke(t)} action="Disconnect" />) : <span className="text-[12.5px] text-caption">None yet. Apps appear here after you allow them.</span>}
      </div>
    </Card>
  );
}

function TokenLine({ t, busy, onRevoke, action }: { t: TokenRow; busy: boolean; onRevoke: () => void; action: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-divider px-3.5 py-2.5">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[14px] font-semibold">{t.name}</span>
        <span className="text-[12.5px] text-caption">
          {t.kind === "key" ? <span className="font-mono">{t.hint}</span> : "OAuth"} · created {when(t.createdAt)} · last used {when(t.lastUsedAt)}
        </span>
      </div>
      {t.lastUsedAt && Date.now() - +new Date(t.lastUsedAt) < 86400_000 ? <Pill kind="ok">Active</Pill> : null}
      <Button size="sm" variant="danger" onClick={onRevoke} busy={busy}>
        {action}
      </Button>
    </div>
  );
}
