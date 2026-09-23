import type { ReactElement } from "react";
import { headlineSize, LOGO_SIZE_PCT, margins, SIG_SIZE_PCT, sigPosition, type LogoPos, type SigPlacement } from "@/lib/render/layout";

// Satori templates for the built-in renderer. Every element with more than one child
// must be display:flex (Satori's layout model).

export type SlideLayout = "headline-center" | "headline-top" | "quote" | "checklist";

export type Slide = {
  headline: string;
  subline?: string | null;
  layout: SlideLayout;
  items?: string[];
};

export type TemplateProps = {
  platform: string;
  w: number;
  h: number;
  slide: Slide;
  bg: string;
  bg2?: string | null;
  fg: string;
  headlineFont: string;
  bodyFont: string;
  logo?: { src: string; aspect: number } | null; // data URI + width/height ratio
  bgImage?: string | null; // data URI drawn full-bleed behind the content (Figma / Higgsfield)
  logoPos: LogoPos;
  logoSize: "S" | "M" | "L";
  signature?: string | null;
  sigPlacement: SigPlacement;
  sigSize: "S" | "M" | "L";
  showHeadline: boolean;
  slideIndex?: number;
  slideCount?: number;
};

export function computeSizes(p: Pick<TemplateProps, "w" | "h" | "platform" | "slide" | "sigSize">) {
  const m = margins(p.w, p.h, p.platform);
  const minDim = Math.min(p.w, p.h);
  const boxW = p.w - 2 * m.side;
  const boxH = (p.h - m.top - m.bottom) * (p.slide.layout === "checklist" ? 0.22 : 0.5);
  const head = headlineSize(p.slide.headline, boxW, boxH, minDim);
  const sub = Math.round(Math.max(minDim * 0.03, Math.min(minDim * 0.045, head * 0.42)));
  const item = Math.round(Math.max(minDim * 0.028, Math.min(minDim * 0.042, (p.h * 0.5) / Math.max(4, (p.slide.items?.length ?? 3) * 2.4))));
  const sig = Math.round(p.h * SIG_SIZE_PCT[p.sigSize]);
  return { m, head, sub, item, sig };
}

export function SlideTemplate(p: TemplateProps): ReactElement {
  const { m, head, sub, item, sig } = computeSizes(p);
  const logoW = Math.round(p.w * LOGO_SIZE_PCT[p.logoSize]);
  const logoH = p.logo ? Math.round(logoW / Math.max(0.2, p.logo.aspect)) : 0;
  const sp = sigPosition(p.logoPos, p.sigPlacement);
  const logoTop = p.logoPos === "tl" || p.logoPos === "tr";

  const background = p.bg2 ? `linear-gradient(135deg, ${p.bg} 0%, ${p.bg2} 100%)` : p.bg;

  const logoEl = p.logo ? <img src={p.logo.src} width={logoW} height={logoH} style={{ width: logoW, height: logoH }} /> : null;
  const sigEl = p.signature ? (
    <span style={{ fontFamily: p.bodyFont, fontSize: sig, color: p.fg, opacity: 0.92, lineHeight: 1.2, whiteSpace: "nowrap" }}>{p.signature}</span>
  ) : null;

  // Five slots around the content: logo goes to its corner, the signature to its placement.
  type Slot = "tl" | "tr" | "bl" | "bc" | "br";
  const sigSlot: Slot = sp.vertical === "top" ? (sp.align === "left" ? "tl" : "tr") : sp.align === "center" ? "bc" : sp.align === "left" ? "bl" : "br";
  const at = (slot: Slot) => (
    <>
      {p.logoPos === slot ? logoEl : null}
      {sigSlot === slot ? sigEl : null}
    </>
  );
  const cell = (slot: Slot, justify: "flex-start" | "center" | "flex-end", grow = true) => (
    <div style={{ display: "flex", flexGrow: grow ? 1 : 0, justifyContent: justify, alignItems: "center", gap: Math.round(sig * 0.6) }}>{at(slot)}</div>
  );
  const topUsed = logoTop || sigSlot === "tl" || sigSlot === "tr";
  const bottomUsed = !logoTop || sigSlot === "bl" || sigSlot === "bc" || sigSlot === "br";

  const topRow = topUsed ? (
    <div style={{ display: "flex", width: "100%", alignItems: "center" }}>
      {cell("tl", "flex-start")}
      {cell("tr", "flex-end")}
    </div>
  ) : null;

  const bottomRow = bottomUsed ? (
    <div style={{ display: "flex", width: "100%", alignItems: "flex-end" }}>
      {cell("bl", "flex-start")}
      {cell("bc", "center")}
      {cell("br", "flex-end")}
    </div>
  ) : null;

  const headlineEl = p.showHeadline ? (
    <span style={{ fontFamily: p.headlineFont, fontWeight: 500, fontSize: head, lineHeight: 1.1, letterSpacing: -head * 0.01, color: p.fg }}>
      {p.slide.layout === "quote" ? `“${p.slide.headline}”` : p.slide.headline}
    </span>
  ) : null;
  const sublineEl = p.slide.subline ? (
    <span style={{ fontFamily: p.bodyFont, fontSize: sub, lineHeight: 1.35, color: p.fg, opacity: 0.92, marginTop: Math.round(sub * 0.8) }}>
      {p.slide.layout === "quote" ? `— ${p.slide.subline}` : p.slide.subline}
    </span>
  ) : null;

  let middle: ReactElement;
  if (p.slide.layout === "checklist") {
    const items = (p.slide.items ?? []).slice(0, 7);
    middle = (
      <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, justifyContent: "center", width: "100%" }}>
        {headlineEl}
        <div style={{ display: "flex", flexDirection: "column", marginTop: Math.round(item * 1.2) }}>
          {items.map((t, i) => (
            <div key={i} style={{ display: "flex", alignItems: "flex-start", marginTop: i ? Math.round(item * 0.7) : 0 }}>
              <span
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: item * 1.6,
                  height: item * 1.6,
                  borderRadius: item * 0.8,
                  border: `${Math.max(2, Math.round(item * 0.08))}px solid ${p.fg}`,
                  fontFamily: p.bodyFont,
                  fontWeight: 600,
                  fontSize: item * 0.8,
                  color: p.fg,
                  flexShrink: 0,
                }}
              >
                {String(i + 1)}
              </span>
              <span style={{ fontFamily: p.bodyFont, fontSize: item, lineHeight: 1.35, color: p.fg, marginLeft: item * 0.7, flexShrink: 1 }}>{t}</span>
            </div>
          ))}
        </div>
      </div>
    );
  } else {
    middle = (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flexGrow: 1,
          width: "100%",
          justifyContent: p.slide.layout === "headline-top" ? "flex-start" : "center",
          paddingTop: p.slide.layout === "headline-top" ? Math.round(m.top * 0.6) : 0,
          alignItems: p.platform === "medium" ? "center" : "flex-start",
          textAlign: p.platform === "medium" ? "center" : "left",
        }}
      >
        {headlineEl}
        {sublineEl}
      </div>
    );
  }

  const counter =
    p.slideCount && p.slideCount > 1 ? (
      <span style={{ position: "absolute", top: m.top, right: m.side, fontFamily: p.bodyFont, fontSize: Math.round(sig * 0.9), color: p.fg, opacity: 0.75 }}>
        {`${(p.slideIndex ?? 0) + 1} / ${p.slideCount}`}
      </span>
    ) : null;

  return (
    <div
      style={{
        width: p.w,
        height: p.h,
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        background,
        backgroundColor: p.bg,
        paddingTop: m.top,
        paddingLeft: m.side,
        paddingRight: m.side,
        paddingBottom: m.bottom,
        position: "relative",
      }}
    >
      {p.bgImage ? <img src={p.bgImage} width={p.w} height={p.h} style={{ position: "absolute", top: 0, left: 0, width: p.w, height: p.h, objectFit: "cover" }} /> : null}
      {/* Brand-colour scrim keeps overlaid text legible on an image background. */}
      {p.bgImage ? <div style={{ position: "absolute", top: 0, left: 0, width: p.w, height: p.h, backgroundColor: p.bg, opacity: 0.62 }} /> : null}
      {topRow}
      {middle}
      {bottomRow}
      {counter && p.logoPos !== "tr" && sigSlot !== "tr" ? counter : null}
    </div>
  );
}
