"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { IconBrand, IconCompose, IconKey, IconPlug, IconPrompts, IconSchedule } from "@/components/icons";
import type { AppStatus } from "@/lib/status";

const NAV = [
  { href: "/compose", label: "Compose", Icon: IconCompose },
  { href: "/schedule", label: "Schedule", Icon: IconSchedule },
  { href: "/prompts", label: "Platform prompts", Icon: IconPrompts },
  { href: "/brand", label: "Brand kit", Icon: IconBrand },
  { href: "/integrations", label: "Integrations", Icon: IconPlug },
  { href: "/settings", label: "Claude API & accounts", Icon: IconKey },
];

function Dot({ on, outline }: { on: boolean; outline?: boolean }) {
  if (outline || !on) return <span className="box-border h-2 w-2 shrink-0 rounded-full border-[1.5px] border-[#8A847A]" />;
  return <span className="h-2 w-2 shrink-0 rounded-full bg-[#6FBF8B]" />;
}

export function Sidebar({ status, email }: { status: AppStatus; email: string }) {
  const path = usePathname();
  return (
    <div className="w-[248px] shrink-0 bg-side">
      <nav aria-label="Main" className="sticky top-0 flex h-screen w-[248px] flex-col gap-8 px-4 py-7 text-bg">
        <div className="flex items-center gap-3 px-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-[9px] bg-accent font-display text-[19px] font-semibold text-white">M</div>
          <div className="flex flex-col gap-0.5">
            <span className="font-display text-xl font-semibold">Multicast</span>
            <span className="text-xs text-side-caption">Social posting agent</span>
          </div>
        </div>
        <div className="flex flex-col gap-1">
          {NAV.map(({ href, label, Icon }) => {
            const on = path?.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={on ? "page" : undefined}
                className={
                  "flex min-h-11 items-center gap-3 rounded-[10px] px-3 text-[14.5px] no-underline " +
                  (on ? "bg-side-active font-medium !text-white" : "!text-side-text hover:bg-side-card")
                }
              >
                <Icon />
                {label}
              </Link>
            );
          })}
        </div>
        <div className="mt-auto flex flex-col gap-3">
          <div className="flex flex-col gap-2.5 rounded-xl bg-side-card p-3.5">
            <span className="text-xs uppercase tracking-[0.04em] text-side-caption">Status</span>
            <div className="flex items-center gap-2 text-[13.5px]">
              <Dot on={status.claude} />
              {status.claude ? "Claude API connected" : "Claude API not connected"}
            </div>
            <div className="flex items-center gap-2 text-[13.5px]">
              <Dot on={status.accountsLinked > 1} />
              {status.accountsLinked} of {status.accountsTotal} accounts linked
            </div>
            <div className={"flex items-center gap-2 text-[13.5px] " + (status.creative ? "" : "text-side-caption")}>
              <Dot on={status.creative > 0} outline={!status.creative} />
              {status.creative} of {status.creativeTotal} creative tools
            </div>
          </div>
          <div className="flex items-center justify-between gap-2 px-2 text-xs text-side-caption">
            <span className="truncate" title={email}>
              {email}
            </span>
            <button type="button" onClick={() => signOut({ callbackUrl: "/login" })} className="min-h-8 cursor-pointer border-0 bg-transparent text-xs text-side-text underline">
              Sign out
            </button>
          </div>
        </div>
      </nav>
    </div>
  );
}
