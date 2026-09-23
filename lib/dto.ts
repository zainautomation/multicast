import type { Draft, ImageAsset, ScheduleItem } from "@prisma/client";

export type ImageDTO = {
  id: string;
  sizeKey: string;
  width: number;
  height: number;
  generator: string;
  urls: string[];
  mimeType: string;
  note: string | null;
  status: string;
  warnings: string[];
  spec: unknown;
};

export type DraftDTO = {
  id: string;
  briefId: string;
  platform: string;
  hasPost: boolean;
  title: string | null;
  subtitle: string | null;
  body: string | null;
  firstComment: string | null;
  hashtags: string[];
  variants: unknown;
  status: string;
  warnings: string[];
  notes: string[];
  model: string | null;
  externalUrl: string | null;
  lastError: string | null;
  images: ImageDTO[];
  schedule: { id: string; runAtUtc: string; mode: string; status: string; externalUrl: string | null } | null;
};

export function imageDTO(i: ImageAsset): ImageDTO {
  return {
    id: i.id,
    sizeKey: i.sizeKey,
    width: i.width,
    height: i.height,
    generator: i.generator,
    urls: i.urls,
    mimeType: i.mimeType,
    note: i.note,
    status: i.status,
    warnings: i.warnings,
    spec: i.spec,
  };
}

/**
 * Warnings are stored with a prefix: "E:" hard violation (blocks Approve), "N:" note.
 * Legacy/unprefixed strings count as notes.
 */
export function splitWarnings(ws: string[]) {
  const errors: string[] = [];
  const notes: string[] = [];
  for (const w of ws) {
    if (w.startsWith("E:")) errors.push(w.slice(2));
    else notes.push(w.startsWith("N:") ? w.slice(2) : w);
  }
  return { errors, notes };
}

export function packWarnings(errors: string[], notes: string[]) {
  return [...errors.map((e) => `E:${e}`), ...notes.map((n) => `N:${n}`)];
}

export function draftDTO(d: Draft & { images?: ImageAsset[]; schedule?: ScheduleItem | null }): DraftDTO {
  const { errors, notes } = splitWarnings(d.warnings);
  return {
    id: d.id,
    briefId: d.briefId,
    platform: d.platform,
    hasPost: d.hasPost,
    title: d.title,
    subtitle: d.subtitle,
    body: d.body,
    firstComment: d.firstComment,
    hashtags: d.hashtags,
    variants: d.variants,
    status: d.status,
    warnings: errors,
    notes,
    model: d.model,
    externalUrl: d.externalUrl,
    lastError: d.lastError,
    images: (d.images ?? []).sort((a, b) => +a.createdAt - +b.createdAt).map(imageDTO),
    schedule: d.schedule
      ? { id: d.schedule.id, runAtUtc: d.schedule.runAtUtc.toISOString(), mode: d.schedule.mode, status: d.schedule.status, externalUrl: d.schedule.externalUrl }
      : null,
  };
}
