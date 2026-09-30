import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { hintOf, newSecret, pkceMatches, sha256 } from "@/lib/tokens";
import { parseRunAt } from "@/lib/mcp/server";

describe("MCP tokens", () => {
  it("makes prefixed, unguessable secrets and stores only a hash", () => {
    const a = newSecret("mc_key");
    const b = newSecret("mc_key");
    expect(a).toMatch(/^mc_key_[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
    expect(sha256(a)).toHaveLength(64);
    expect(hintOf(a)).toBe(a.slice(0, 13) + "…");
  });
  it("checks PKCE S256 (RFC 7636 appendix B example)", () => {
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    expect(createHash("sha256").update(verifier).digest("base64url")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    expect(pkceMatches(verifier, "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")).toBe(true);
    expect(pkceMatches(verifier + "x", "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")).toBe(false);
    expect(pkceMatches(verifier, "short")).toBe(false);
  });
});

describe("schedule times from agents", () => {
  it("reads a time without an offset in the workspace time zone", () => {
    expect(parseRunAt("2026-10-02T09:30", "Asia/Dubai").toISOString()).toBe("2026-10-02T05:30:00.000Z");
    expect(parseRunAt("2026-01-15 09:30:00", "America/New_York").toISOString()).toBe("2026-01-15T14:30:00.000Z");
  });
  it("keeps explicit offsets and Z exact", () => {
    expect(parseRunAt("2026-10-02T09:30:00Z", "Asia/Dubai").toISOString()).toBe("2026-10-02T09:30:00.000Z");
    expect(parseRunAt("2026-10-02T09:30:00+01:00", "Asia/Dubai").toISOString()).toBe("2026-10-02T08:30:00.000Z");
  });
  it("rejects nonsense", () => {
    expect(() => parseRunAt("next friday", "UTC")).toThrow(/Not a date-time/);
  });
});
