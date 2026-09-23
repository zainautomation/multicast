import { promises as fs } from "node:fs";
import path from "node:path";
import { readObject } from "@/lib/storage";

// Fonts for Satori. Satori reads TTF/OTF/WOFF (not WOFF2), so uploaded WOFF2 brand fonts
// are decompressed to TTF first.

export type SatoriFont = { name: string; data: ArrayBuffer | Buffer; weight: 400 | 500 | 600 | 700; style: "normal" | "italic" };
export type CustomFont = { family: string; url: string; weight?: number; style?: "normal" | "italic" };

const FS = (pkg: string, file: string) => path.join(process.cwd(), "node_modules", "@fontsource", pkg, "files", file);

const BUILTIN: { name: string; weight: 400 | 500 | 600; file: string }[] = [
  { name: "Fraunces", weight: 500, file: FS("fraunces", "fraunces-latin-500-normal.woff") },
  { name: "Fraunces", weight: 600, file: FS("fraunces", "fraunces-latin-600-normal.woff") },
  { name: "IBM Plex Sans", weight: 400, file: FS("ibm-plex-sans", "ibm-plex-sans-latin-400-normal.woff") },
  { name: "IBM Plex Sans", weight: 500, file: FS("ibm-plex-sans", "ibm-plex-sans-latin-500-normal.woff") },
  { name: "IBM Plex Sans", weight: 600, file: FS("ibm-plex-sans", "ibm-plex-sans-latin-600-normal.woff") },
];

export const BUILTIN_FAMILIES = ["Fraunces", "IBM Plex Sans"];

let builtinCache: SatoriFont[] | null = null;
const customCache = new Map<string, SatoriFont>();

async function builtinFonts(): Promise<SatoriFont[]> {
  if (!builtinCache) {
    builtinCache = await Promise.all(
      BUILTIN.map(async (f) => ({ name: f.name, weight: f.weight, style: "normal" as const, data: await fs.readFile(f.file) })),
    );
  }
  return builtinCache;
}

async function toSfnt(buf: Buffer): Promise<Buffer> {
  // WOFF2 signature "wOF2"
  if (buf.subarray(0, 4).toString("latin1") === "wOF2") {
    const { decompress } = (await import("wawoff2")) as unknown as { decompress: (b: Uint8Array) => Promise<Uint8Array> };
    return Buffer.from(await decompress(buf));
  }
  return buf;
}

export async function loadFonts(custom: CustomFont[] = []): Promise<SatoriFont[]> {
  const fonts = [...(await builtinFonts())];
  for (const c of custom) {
    const key = `${c.family}|${c.url}`;
    let f = customCache.get(key);
    if (!f) {
      try {
        const data = await toSfnt(await readObject(c.url));
        const w = [400, 500, 600, 700].includes(c.weight ?? 0) ? (c.weight as 400) : 500;
        f = { name: c.family, data, weight: w, style: c.style ?? "normal" };
        customCache.set(key, f);
      } catch (e) {
        console.warn(`[fonts] could not load ${c.family}:`, e instanceof Error ? e.message : e);
        continue;
      }
    }
    fonts.push(f);
  }
  return fonts;
}
