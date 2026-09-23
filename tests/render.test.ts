import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { renderSlides } from "@/lib/render/render";
import type { Brand } from "@/lib/brand";
import { SEED_BACKGROUNDS, SEED_TEXT_COLORS } from "@/lib/prompts/defaults";

const brand: Brand = {
  logos: { primary: null, reverse: null, icon: null },
  logoPosition: "tl",
  logoSize: "M",
  autoReverse: true,
  sigCompany: "Acme · acme.test",
  sigPersonal: "Jo Doe · Founder",
  sigPlacement: "opposite",
  sigSize: "S",
  backgrounds: SEED_BACKGROUNDS,
  textColors: SEED_TEXT_COLORS,
  headlineFont: "Fraunces",
  bodyFont: "IBM Plex Sans",
  customFonts: [],
  bannedPhrases: [],
};

describe("built-in renderer", () => {
  it("renders an Instagram JPEG at exactly 1080 × 1350", async () => {
    const out = await renderSlides({
      platform: "ig",
      w: 1080,
      h: 1350,
      slides: [{ headline: "Hiring across borders, minus the headache", subline: null, layout: "headline-center" }],
      bgHex: "#A8461F",
      fgHex: "#FFFFFF",
      include: { logo: true, sig: true, headline: true },
      brand,
      format: "jpeg",
    });
    expect(out.mime).toBe("image/jpeg");
    const meta = await sharp(out.images[0]).metadata();
    expect([meta.width, meta.height, meta.format]).toEqual([1080, 1350, "jpeg"]);
    expect(out.warnings.join(" ")).toMatch(/No logo uploaded/);
  }, 30_000);

  it("renders one PNG per carousel slide and enforces contrast", async () => {
    const out = await renderSlides({
      platform: "lic",
      w: 1200,
      h: 627,
      slides: [
        { headline: "The practical guide", subline: "For founders and HR leads", layout: "headline-top" },
        { headline: "Inside", layout: "checklist", items: ["Contracts", "Compliance", "Payroll"] },
      ],
      bgHex: "#F4F1EA",
      fgHex: "#FFFFFF", // fails on Ivory → must fall back
      include: { logo: false, sig: true, headline: true },
      brand,
    });
    expect(out.images).toHaveLength(2);
    expect(out.fgUsed).toBe("#1B1A17");
    expect(out.warnings.join(" ")).toMatch(/below/);
    const meta = await sharp(out.images[1]).metadata();
    expect([meta.width, meta.height]).toEqual([1200, 627]);
  }, 30_000);
});
