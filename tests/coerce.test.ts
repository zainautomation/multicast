import { describe, expect, it } from "vitest";
import { asArray, asStrings } from "@/lib/generation/coerce";
import { parseSlides } from "@/lib/generation/image";
import { normalise } from "@/lib/generation/text";

const slide = { headline: "Hiring abroad, simply", subline: null, layout: "headline-center", items: [] };

describe("tolerant tool-input parsing", () => {
  it("reads slides sent as a JSON string (the '.filter is not a function' bug)", () => {
    const s = parseSlides({ slides: JSON.stringify([slide]) });
    expect(s).toHaveLength(1);
    expect(s[0].headline).toBe("Hiring abroad, simply");
  });
  it("reads a single slide object without the array", () => {
    expect(parseSlides({ slides: slide })).toHaveLength(1);
  });
  it("reads items sent as a string and unknown layouts", () => {
    const s = parseSlides({ slides: [{ headline: "List", layout: "grid", items: '["a","b"]' }] });
    expect(s[0]).toMatchObject({ layout: "headline-center", items: ["a", "b"] });
  });
  it("returns no slides (not a crash) for junk", () => {
    expect(parseSlides({ slides: 42 })).toEqual([]);
    expect(parseSlides(null)).toEqual([]);
  });
  it("normalises string-encoded draft fields", () => {
    const d = normalise(
      { title: null, body: "Post", first_comment: null, hashtags: '["#a","b"]', visual_brief: JSON.stringify({ format: "carousel", slides: [slide] }), placeholders: "[YOUR LINK]" },
      "ig",
    );
    expect(d.hashtags).toEqual(["a", "b"]);
    expect(d.visual_brief?.format).toBe("carousel");
    expect(d.visual_brief?.slides).toHaveLength(1);
    expect(d.placeholders).toEqual(["[YOUR LINK]"]);
  });
  it("asArray / asStrings basics", () => {
    expect(asArray({ 0: "x", 1: "y" })).toEqual(["x", "y"]);
    expect(asStrings("a, b\nc")).toEqual(["a", "b", "c"]);
  });
});
