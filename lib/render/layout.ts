// Pure layout maths for the built-in renderer (unit-tested; no Satori dependency).

export type LogoPos = "tl" | "tr" | "bl" | "br";
export type SigPlacement = "opposite" | "center" | "top";

export const LOGO_SIZE_PCT = { S: 0.06, M: 0.09, L: 0.12 } as const;
export const SIG_SIZE_PCT = { S: 0.025, M: 0.035, L: 0.045 } as const;

export function margins(w: number, h: number, platform: string) {
  const minDim = Math.min(w, h);
  let side = Math.round(minDim * 0.08);
  let bottom = side;
  if (platform === "ig") {
    // 120 px safe margin at 1080 wide; nothing important in the bottom 15% (UI overlays)
    side = Math.max(side, Math.round((120 / 1080) * w));
    bottom = Math.max(side, Math.round(h * 0.15));
  }
  return { top: side, side, bottom };
}

/** Area-based headline sizing so long lines shrink and short hooks go big. */
export function headlineSize(text: string, boxW: number, boxH: number, minDim: number): number {
  const n = Math.max(8, text.length);
  const est = Math.sqrt((boxW * boxH) / (n * 0.56 * 1.18));
  return Math.round(Math.max(minDim * 0.045, Math.min(minDim * 0.12, est)));
}

/** Where the signature goes relative to the logo. */
export function sigPosition(logo: LogoPos, placement: SigPlacement): { vertical: "top" | "bottom"; align: "left" | "center" | "right" } {
  const logoLeft = logo === "tl" || logo === "bl";
  if (placement === "center") return { vertical: "bottom", align: "center" };
  if (placement === "top") return { vertical: "top", align: logoLeft ? "right" : "left" };
  return { vertical: "bottom", align: logoLeft ? "right" : "left" };
}

/** Text rendered at 24 px or more counts as large (3:1 minimum); smaller text needs 4.5:1. */
export function isLargeText(px: number): boolean {
  return px >= 24;
}
