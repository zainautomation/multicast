import type { Draft, ImageAsset } from "@prisma/client";
import type { PlatformId } from "@/lib/platforms";
import type { Account } from "@/lib/publishers/accounts";

export type PublishResult = { externalId: string; url: string };

export interface Publisher {
  platform: PlatformId;
  canAutoPublish(account: Account | null): boolean;
  publish(draft: Draft & { brief?: { subreddit: string | null } }, images: ImageAsset[], account: Account, token: string): Promise<PublishResult>;
  /** Pre-flight errors; empty = OK to publish. */
  validate(draft: Draft, images: ImageAsset[]): string[];
}

export class PublishError extends Error {
  constructor(message: string, public retryable = true) {
    super(message);
  }
}

export async function jsonOrThrow(res: Response, what: string) {
  const text = await res.text();
  let body: unknown = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  if (!res.ok) {
    const b = body as { error?: { message?: string } | string; message?: string };
    const msg = typeof b.error === "string" ? b.error : b.error?.message || b.message || text.slice(0, 300);
    // 4xx other than 408/429 will not get better by retrying
    const retryable = res.status >= 500 || res.status === 429 || res.status === 408;
    throw new PublishError(`${what} failed (${res.status}): ${msg}`, retryable);
  }
  return body as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
}

export function fullText(d: Draft): string {
  return d.body ?? "";
}
