import { describe, expect, it } from "vitest";
import { authHeader, sign, signatureBase } from "@/lib/oauth1";
import { xLength } from "@/lib/xtext";

describe("OAuth 1.0a signing", () => {
  // The worked example from X's "Creating a signature" documentation.
  const keys = {
    consumerKey: "xvz1evFS4wEEPTGEFPHBog",
    consumerSecret: "kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw",
    token: "370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb",
    tokenSecret: "LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE",
  };
  const url = "https://api.twitter.com/1.1/statuses/update.json?include_entities=true";
  const params = {
    status: "Hello Ladies + Gentlemen, a signed OAuth request!",
    oauth_consumer_key: keys.consumerKey,
    oauth_nonce: "kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg",
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: "1318622958",
    oauth_token: keys.token,
    oauth_version: "1.0",
  };

  it("builds the documented signature base string", () => {
    expect(signatureBase("POST", url, params)).toBe(
      "POST&https%3A%2F%2Fapi.twitter.com%2F1.1%2Fstatuses%2Fupdate.json&include_entities%3Dtrue%26oauth_consumer_key%3Dxvz1evFS4wEEPTGEFPHBog%26oauth_nonce%3DkYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg%26oauth_signature_method%3DHMAC-SHA1%26oauth_timestamp%3D1318622958%26oauth_token%3D370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb%26oauth_version%3D1.0%26status%3DHello%2520Ladies%2520%252B%2520Gentlemen%252C%2520a%2520signed%2520OAuth%2520request%2521",
    );
  });
  it("produces the documented signature", () => {
    expect(sign(signatureBase("POST", url, params), keys.consumerSecret, keys.tokenSecret)).toBe("hCtSmYh+iHYCEqBWrE7C7hYmtUk=");
  });
  it("puts the signature in the Authorization header", () => {
    const h = authHeader("POST", url, keys, { formParams: { status: params.status }, nonce: params.oauth_nonce, timestamp: params.oauth_timestamp });
    expect(h).toContain('oauth_signature="hCtSmYh%2BiHYCEqBWrE7C7hYmtUk%3D"');
    expect(h.startsWith("OAuth ")).toBe(true);
  });
});

describe("X weighted length", () => {
  it("counts plain text by character", () => {
    expect(xLength("Hello world")).toBe(11);
  });
  it("counts every URL as 23", () => {
    expect(xLength("Read https://example.com/a/very/long/path/that/goes/on and on")).toBe(5 + 23 + 7);
  });
  it("counts emoji and CJK as 2", () => {
    expect(xLength("👍")).toBe(2);
    expect(xLength("👨‍👩‍👧")).toBe(2);
    expect(xLength("日本")).toBe(4);
  });
});

import { validateDraft } from "@/lib/generation/validate";
import { hardLimitsBlock, findSize } from "@/lib/platforms";
import { xPublisher } from "@/lib/publishers/x";

describe("X platform rules", () => {
  it("validates with X's weighted count, not plain length", () => {
    // 257 plain chars + a long URL: plain length > 280, weighted = 257 + 1 + 23 = 281 → over
    const long = "a".repeat(257) + " https://example.com/" + "p".repeat(60);
    expect(validateDraft("x", { body: long }).errors.join(" ")).toMatch(/281 characters as X counts them; the limit is 280/);
    // Same text with a short URL is still 281 weighted: URL length doesn't matter
    expect(validateDraft("x", { body: "a".repeat(257) + " https://x.co" }).errors.join(" ")).toMatch(/281/);
    expect(validateDraft("x", { body: "a".repeat(250) + " https://example.com/" + "p".repeat(200) }).errors).toEqual([]);
  });
  it("tells Claude how X counts and defaults to a 16:9 image", () => {
    expect(hardLimitsBlock("x")).toMatch(/every URL counts as 23/);
    expect(findSize("x")).toMatchObject({ w: 1600, h: 900 });
  });
  it("pre-flight rejects video and more than 4 images", () => {
    const d = { body: "Hi", hasPost: true } as never;
    const img = (n: number, mime = "image/png") => ({ mimeType: mime, urls: Array.from({ length: n }, (_, i) => `https://cdn/${i}.png`) }) as never;
    expect(xPublisher.validate(d, [img(5)]).join(" ")).toMatch(/at most 4 images/);
    expect(xPublisher.validate(d, [img(1, "video/mp4")]).join(" ")).toMatch(/Video/);
    expect(xPublisher.validate(d, [img(2)])).toEqual([]);
  });
});
