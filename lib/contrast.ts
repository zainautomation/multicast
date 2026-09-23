// WCAG 2.x relative luminance and contrast. Shared by the UI readouts and the renderer.

export function hexToRgb(hex: string): [number, number, number] {
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h.slice(0, 6), 16);
  if (Number.isNaN(n)) return [0, 0, 0];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

export type ContrastVerdict = { ratio: number; label: string; level: "pass" | "large" | "fail" };

export function contrastVerdict(bg: string, fg: string): ContrastVerdict {
  const ratio = contrastRatio(bg, fg);
  if (ratio >= 4.5) return { ratio, label: `${ratio.toFixed(1)}:1 passes`, level: "pass" };
  if (ratio >= 3) return { ratio, label: `${ratio.toFixed(1)}:1 large text only`, level: "large" };
  return { ratio, label: `${ratio.toFixed(1)}:1 too low`, level: "fail" };
}

export const VERDICT_COLOR = { pass: "#1F4D33", large: "#7A3E0E", fail: "#B42318" } as const;

/** Spec rule: backgrounds with luminance under 0.4 count as dark (use the reverse logo). */
export function isDark(hex: string): boolean {
  return luminance(hex) < 0.4;
}

/**
 * Pick the text colour to render with. If the configured pair fails the minimum
 * (4.5:1 body, 3:1 for large text), fall back to the kit colour with the best contrast.
 */
export function ensureContrast(
  bg: string,
  fg: string,
  palette: string[],
  minRatio = 4.5,
): { fg: string; fellBack: boolean; ratio: number } {
  const r = contrastRatio(bg, fg);
  if (r >= minRatio) return { fg, fellBack: false, ratio: r };
  const candidates = [...palette, "#000000", "#FFFFFF"];
  let best = fg;
  let bestR = r;
  for (const c of palette) {
    const cr = contrastRatio(bg, c);
    if (cr > bestR) {
      best = c;
      bestR = cr;
    }
  }
  // If even the kit's best colour fails, use black or white; the rule is absolute.
  if (bestR < minRatio) {
    for (const c of candidates.slice(-2)) {
      const cr = contrastRatio(bg, c);
      if (cr > bestR) {
        best = c;
        bestR = cr;
      }
    }
  }
  return { fg: best, fellBack: true, ratio: bestR };
}
