"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, Button, Card, Field, inputCls, inputMutedCls, Monogram, PageHeader, Pill, useToast } from "@/components/ui";

export type AccountRow = {
  id: "meta" | "linkedin" | "reddit" | "medium" | "quora";
  name: string;
  mono: string;
  color: string;
  detail: string;
  status: "connected" | "reconnect" | "none" | "setup" | "copy";
  kind: "oauth" | "token" | "copy";
  setupHint?: string;
  expires?: string | null;
  pages?: { id: string; name: string; ig: string | null; current: boolean }[];
};

type Claude = {
  hasKey: boolean;
  last4: string | null;
  verifiedAt: string | null;
  draftModel: string;
  checkerModel: string;
  creativity: string;
  monthlyCapCents: number | null;
  spendMicro: number;
  runs: number;
};

const STATUS: Record<AccountRow["status"], { label: string; kind: "ok" | "warn" | "none" | "danger" }> = {
  connected: { label: "Connected", kind: "ok" },
  reconnect: { label: "Needs reconnect", kind: "danger" },
  none: { label: "Not linked", kind: "none" },
  setup: { label: "Setup needed", kind: "none" },
  copy: { label: "Copy mode", kind: "warn" },
};

export function SettingsClient({
  claude,
  draftModels,
  checkerModels,
  accounts,
  flash,
}: {
  claude: Claude;
  draftModels: { id: string; label: string }[];
  checkerModels: { id: string; label: string }[];
  accounts: AccountRow[];
  flash: { connected: string | null; error: string | null };
}) {
  const router = useRouter();
  const toast = useToast();
  const [key, setKey] = useState("");
  const [show, setShow] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testNote, setTestNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [cap, setCap] = useState(claude.monthlyCapCents != null ? `$${(claude.monthlyCapCents / 100).toFixed(0)}` : "");
  const [open, setOpen] = useState<string | null>(null);
  const [mediumToken, setMediumToken] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (flash.connected) toast(`${flash.connected[0].toUpperCase()}${flash.connected.slice(1)} connected`, "ok");
    if (flash.error) toast(flash.error, "error");
    if (flash.connected || flash.error) router.replace("/settings");
  }, [flash.connected, flash.error]); // eslint-disable-line react-hooks/exhaustive-deps

  async function saveSetting(patch: Record<string, unknown>) {
    try {
      await api("/api/settings", { method: "PUT", json: patch });
      toast("Saved", "ok");
      router.refresh();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  async function test() {
    setTesting(true);
    setTestNote(null);
    try {
      await api("/api/settings/claude-key", { method: "POST", json: { apiKey: key || undefined } });
      setTestNote({ ok: true, text: key ? "Test call succeeded · key saved and encrypted" : "Test call succeeded · key valid" });
      setKey("");
      router.refresh();
    } catch (e) {
      setTestNote({ ok: false, text: (e as Error).message });
    } finally {
      setTesting(false);
    }
  }

  async function removeKey() {
    if (!confirm("Remove the Claude API key? Generation stops until you add one again.")) return;
    await api("/api/settings/claude-key", { method: "DELETE" });
    setTestNote(null);
    router.refresh();
  }

  function saveCap() {
    const n = cap.replace(/[^0-9.]/g, "");
    saveSetting({ monthlyCapCents: n ? Math.round(parseFloat(n) * 100) : null });
  }

  async function disconnect(id: string) {
    if (!confirm("Disconnect this account? Scheduled auto-posts for it will switch to failing until you reconnect.")) return;
    setBusy(id);
    try {
      await api(`/api/accounts/${id}`, { method: "DELETE" });
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function addMedium() {
    setBusy("medium");
    try {
      const r = await api<{ displayName: string }>("/api/accounts/medium", { method: "POST", json: { token: mediumToken } });
      toast(`Medium connected as ${r.displayName}`, "ok");
      setMediumToken("");
      setOpen(null);
      router.refresh();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(null);
    }
  }

  async function switchPage(pageId: string) {
    setBusy("meta");
    try {
      await api("/api/accounts/meta", { method: "PUT", json: { pageId } });
      router.refresh();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(null);
    }
  }

  const connected = claude.hasKey;
  const spend = claude.spendMicro / 1e6;

  return (
    <>
      <PageHeader eyebrow="Claude API & accounts" title="The engine and the outlets." />

      <div className="flex flex-wrap items-start gap-6">
        <Card aria-label="Claude API" className="flex w-[520px] max-w-full shrink-0 flex-col gap-5 p-[26px]">
          <div className="flex items-center gap-3.5">
            <span className="flex h-11 w-11 items-center justify-center rounded-[11px] bg-accent font-display text-xl font-semibold text-white">C</span>
            <div className="flex flex-1 flex-col gap-0.5">
              <h2 className="m-0 font-display text-2xl font-medium">Claude API</h2>
              <span className="text-[13px] text-caption">Required · writes every draft</span>
            </div>
            <Pill kind={connected ? "ok" : "warn"}>{connected ? "Connected" : "Not connected"}</Pill>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="key" className="text-[13.5px] font-semibold">
              API key
            </label>
            <div className="flex gap-2">
              <input
                id="key"
                type={show ? "text" : "password"}
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder={claude.hasKey ? `sk-ant-••••••••${claude.last4 ?? ""}` : "sk-ant-api03-…"}
                autoComplete="off"
                spellCheck={false}
                className={inputMutedCls + " min-w-0 flex-1 font-mono text-[13px]"}
              />
              <Button onClick={() => setShow((x) => !x)}>{show ? "Hide" : "Show"}</Button>
            </div>
            <span className="text-[12.5px] text-caption">
              Create one at <a href="https://console.anthropic.com" target="_blank" rel="noreferrer">console.anthropic.com</a>. Stored encrypted on the server, never in the browser.
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3.5">
            <Field label="Drafting model">
              {(id) => (
                <select id={id} className={inputCls} defaultValue={claude.draftModel} onChange={(e) => saveSetting({ draftModel: e.target.value })}>
                  {draftModels.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="Spec checker model">
              {(id) => (
                <select id={id} className={inputCls} defaultValue={claude.checkerModel} onChange={(e) => saveSetting({ checkerModel: e.target.value })}>
                  {checkerModels.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="Creativity" hint="Temperature applies to models that accept it (Haiku 4.5).">
              {(id) => (
                <select id={id} className={inputCls} defaultValue={claude.creativity} onChange={(e) => saveSetting({ creativity: e.target.value })}>
                  <option value="balanced">Balanced</option>
                  <option value="precise">Precise</option>
                  <option value="creative">Creative</option>
                </select>
              )}
            </Field>
            <Field label="Monthly spend cap" hint={`This month: $${spend.toFixed(2)} across ${claude.runs} calls`}>
              {(id) => <input id={id} className={inputCls} value={cap} placeholder="No cap" onChange={(e) => setCap(e.target.value)} onBlur={saveCap} onKeyDown={(e) => e.key === "Enter" && saveCap()} />}
            </Field>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <Button variant="dark" onClick={test} busy={testing} disabled={!key && !claude.hasKey}>
              {key ? "Save & test" : "Test connection"}
            </Button>
            {claude.hasKey ? (
              <Button variant="danger" onClick={removeKey}>
                Remove key
              </Button>
            ) : null}
            <span role="status" className={"ml-auto text-[13px] " + (testNote?.ok === false ? "text-danger-text" : "text-success-text")}>
              {testNote?.text ?? (claude.verifiedAt ? `Verified ${new Date(claude.verifiedAt).toLocaleString()}` : "")}
            </span>
          </div>
        </Card>

        <Card aria-label="Publishing accounts" className="flex min-w-[420px] flex-1 flex-col gap-1.5 p-[26px]">
          <h2 className="m-0 font-display text-2xl font-medium">Publishing accounts</h2>
          <p className="m-0 mb-2.5 text-[13.5px] leading-normal text-muted">Where approved drafts go. Platforms without a posting API stay in copy-and-paste mode.</p>
          {accounts.map((a) => {
            const s = STATUS[a.status];
            const action =
              a.kind === "copy" ? "Learn more" : a.kind === "token" ? (a.status === "connected" ? "Manage" : "Add token") : a.status === "connected" ? "Manage" : a.status === "reconnect" ? "Reconnect" : "Connect";
            const isOpen = open === a.id;
            return (
              <div key={a.id} className="border-t border-divider py-3.5">
                <div className="flex items-center gap-3.5">
                  <Monogram mono={a.mono} color={a.color} size={36} />
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="text-[14.5px] font-semibold">{a.name}</span>
                    <span className="text-[12.5px] text-caption">{a.detail}</span>
                  </div>
                  <Pill kind={s.kind}>{s.label}</Pill>
                  {a.kind === "oauth" && (a.status === "none" || a.status === "reconnect") ? (
                    <a href={`/api/oauth/${a.id}/start`} className="inline-flex min-h-10 min-w-[104px] items-center justify-center rounded-[9px] border border-input bg-surface px-3.5 text-[13px] !text-ink no-underline hover:bg-surface-muted">
                      {action}
                    </a>
                  ) : (
                    <Button size="sm" className="min-w-[104px]" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : a.id)}>
                      {action}
                    </Button>
                  )}
                </div>
                {isOpen ? (
                  <div className="ml-[50px] mt-3 flex flex-col gap-3 rounded-xl bg-bg p-4 text-[13.5px] text-muted">
                    {a.status === "setup" ? <p className="m-0">{a.setupHint}, then restart the app.</p> : null}
                    {a.kind === "copy" ? (
                      <p className="m-0 leading-normal">
                        Quora has no public posting API. Quora drafts get a <b>Copy text</b> button, and scheduled Quora posts always use <b>Remind me</b>: at the set time you get the final copy, the image and a link to Quora.
                      </p>
                    ) : null}
                    {a.id === "medium" ? (
                      <div className="flex flex-col gap-2">
                        <label htmlFor="medtok" className="font-semibold text-ink">
                          Integration token
                        </label>
                        <div className="flex gap-2">
                          <input id="medtok" type="password" className={inputCls + " font-mono text-[13px]"} value={mediumToken} onChange={(e) => setMediumToken(e.target.value)} placeholder={a.status === "connected" ? "Replace token…" : "2a1b…"} />
                          <Button variant="dark" onClick={addMedium} busy={busy === "medium"} disabled={mediumToken.length < 10}>
                            Save
                          </Button>
                        </div>
                        <span className="text-[12.5px]">From Medium → Settings → Security and apps → Integration tokens, if your account still has one.</span>
                      </div>
                    ) : null}
                    {a.id === "meta" && a.pages && a.pages.length > 1 ? (
                      <Field label="Post to Page">
                        {(id) => (
                          <select id={id} className={inputCls} value={a.pages!.find((p) => p.current)?.id} onChange={(e) => switchPage(e.target.value)}>
                            {a.pages!.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name}
                                {p.ig ? ` · @${p.ig}` : ""}
                              </option>
                            ))}
                          </select>
                        )}
                      </Field>
                    ) : null}
                    {a.expires ? <span>Access expires {new Date(a.expires).toLocaleDateString()}. Reconnect before then to keep auto-posting.</span> : null}
                    {a.status === "connected" ? (
                      <div className="flex gap-2">
                        {a.kind === "oauth" ? (
                          <a href={`/api/oauth/${a.id}/start`} className="inline-flex min-h-10 items-center rounded-[9px] border border-input bg-surface px-3.5 text-[13px] !text-ink no-underline">
                            Reconnect
                          </a>
                        ) : null}
                        <Button size="sm" variant="danger" onClick={() => disconnect(a.id)} busy={busy === a.id}>
                          Disconnect
                        </Button>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </Card>
      </div>
    </>
  );
}
