// Tool inputs are parsed JSON, but models occasionally encode a nested array or object as a
// JSON string ("[{...}]"), wrap a single item without the array, or send a comma list. These
// helpers turn whatever arrived into the shape the schema promised, without throwing.

function parseMaybe(v: unknown): unknown {
  if (typeof v !== "string") return v;
  const s = v.trim();
  if ((s.startsWith("[") && s.endsWith("]")) || (s.startsWith("{") && s.endsWith("}"))) {
    try {
      return JSON.parse(s);
    } catch {
      return v;
    }
  }
  return v;
}

/** Any value → array. A JSON string is parsed; a lone object/string becomes a one-item array. */
export function asArray<T = unknown>(v: unknown, opts: { splitStrings?: boolean } = {}): T[] {
  const p = parseMaybe(v);
  if (Array.isArray(p)) return p as T[];
  if (p === null || p === undefined || p === "") return [];
  if (typeof p === "string" && opts.splitStrings) return p.split(/[,\n]/).map((x) => x.trim()).filter(Boolean) as T[];
  if (typeof p === "object") {
    // {slides:[...]} nested one level too deep, or {"0":{...},"1":{...}}
    const o = p as Record<string, unknown>;
    const inner = Object.values(o).find(Array.isArray);
    if (inner && Object.keys(o).length === 1) return inner as T[];
    if (Object.keys(o).every((k) => /^\d+$/.test(k))) return Object.values(o) as T[];
  }
  return [p as T];
}

/** Any value → string array (hashtags, items, placeholders). */
export function asStrings(v: unknown): string[] {
  return asArray(v, { splitStrings: true })
    .map((x) => (typeof x === "string" ? x : x === null || x === undefined ? "" : typeof x === "object" ? JSON.stringify(x) : String(x)))
    .map((x) => x.trim())
    .filter(Boolean);
}

/** Any value → plain object or null. */
export function asObject<T extends object = Record<string, unknown>>(v: unknown): T | null {
  const p = parseMaybe(v);
  return p && typeof p === "object" && !Array.isArray(p) ? (p as T) : null;
}

export function asText(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v;
  return String(v);
}
