"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { Button, Field, inputMutedCls } from "@/components/ui";

export function AuthForm({ mode }: { mode: "login" | "setup" }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "setup") {
        const res = await fetch("/api/setup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password, name: name || undefined }) });
        const data = await res.json();
        if (!res.ok) throw new Error(data.issues?.[0]?.message ?? data.error ?? "Could not create the account");
      }
      const r = await signIn("credentials", { email, password, redirect: false });
      if (!r || r.error) throw new Error("Email or password is incorrect");
      window.location.href = mode === "setup" ? "/settings" : "/compose";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <form onSubmit={submit} className="flex w-full max-w-[420px] flex-col gap-5 rounded-[16px] border border-line bg-surface p-8">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-accent font-display text-xl font-semibold text-white">M</div>
          <div className="flex flex-col">
            <span className="font-display text-[22px] font-semibold">Multicast</span>
            <span className="text-[13px] text-caption">Social posting agent</span>
          </div>
        </div>
        <h1 className="m-0 font-display text-[28px] font-medium">{mode === "setup" ? "Create the owner account" : "Sign in"}</h1>
        {mode === "setup" ? (
          <p className="m-0 text-[14px] leading-normal text-muted">Multicast is a single-owner app. This account is created once; after that the page is locked.</p>
        ) : null}
        {mode === "setup" ? (
          <Field label="Your name (optional)">{(id) => <input id={id} className={inputMutedCls} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />}</Field>
        ) : null}
        <Field label="Email">{(id) => <input id={id} type="email" required className={inputMutedCls} value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />}</Field>
        <Field label="Password" hint={mode === "setup" ? "At least 10 characters." : undefined}>
          {(id) => (
            <input id={id} type="password" required minLength={mode === "setup" ? 10 : 1} className={inputMutedCls} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === "setup" ? "new-password" : "current-password"} />
          )}
        </Field>
        {error ? (
          <p role="alert" className="m-0 text-[13.5px] text-danger-text">
            {error}
          </p>
        ) : null}
        <Button type="submit" variant="primary" size="lg" busy={busy}>
          {mode === "setup" ? "Create account" : "Sign in"}
        </Button>
      </form>
    </div>
  );
}
