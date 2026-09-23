import { normalizeSubreddit } from "@/lib/platforms";

// Fetch a subreddit's rules and posting constraints before generating (spec §4, §10).
// Uses the public JSON endpoints with a descriptive User-Agent; when an OAuth token is
// available the oauth.reddit.com host is used instead. [verify] endpoints and fields.

export type SubredditInfo = {
  name: string;
  rulesText: string;
  allowImages: boolean;
  submissionType: string | null; // any | self | link
  flairRequired: boolean;
};

const UA = () => process.env.REDDIT_USER_AGENT || "web:multicast:v0.1 (by /u/multicast)";

async function getJson(url: string, token?: string) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA(), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Reddit ${res.status} for ${url}`);
  return res.json();
}

const cache = new Map<string, { at: number; info: SubredditInfo }>();

export async function fetchSubredditInfo(sub: string, token?: string): Promise<SubredditInfo> {
  const name = normalizeSubreddit(sub).slice(2);
  const hit = cache.get(name.toLowerCase());
  if (hit && Date.now() - hit.at < 30 * 60_000) return hit.info;
  const host = token ? "https://oauth.reddit.com" : "https://www.reddit.com";
  const sfx = token ? "" : ".json";

  const [rules, about, reqs] = await Promise.allSettled([
    getJson(`${host}/r/${name}/about/rules${sfx}`, token),
    getJson(`${host}/r/${name}/about${sfx}`, token),
    token ? getJson(`${host}/api/v1/${name}/post_requirements`, token) : Promise.resolve(null),
  ]);

  const lines: string[] = [];
  if (rules.status === "fulfilled") {
    const list = (rules.value?.rules ?? []) as { short_name?: string; description?: string }[];
    list.forEach((r, i) => lines.push(`${i + 1}. ${r.short_name ?? ""}${r.description ? ` — ${r.description.replace(/\s+/g, " ").trim()}` : ""}`));
  }
  const data = about.status === "fulfilled" ? about.value?.data ?? {} : {};
  const req = reqs.status === "fulfilled" ? reqs.value ?? {} : {};
  if (data.submission_type === "self") lines.push("Only text posts are allowed.");
  if (data.submission_type === "link") lines.push("Only link posts are allowed.");
  if (req.is_flair_required) lines.push("A post flair is required.");
  if (req.title_text_min_length || req.title_text_max_length)
    lines.push(`Title length must be between ${req.title_text_min_length ?? 0} and ${req.title_text_max_length ?? 300} characters.`);
  if (req.body_restriction_policy === "required") lines.push("A text body is required.");
  if (req.body_restriction_policy === "notAllowed") lines.push("Text bodies are not allowed.");

  const info: SubredditInfo = {
    name: `r/${name}`,
    rulesText: lines.length ? lines.join("\n") : "(This subreddit publishes no rules. Be conservative: no self-promotion, disclose affiliation.)",
    allowImages: data.allow_images !== false && data.submission_type !== "self",
    submissionType: data.submission_type ?? null,
    flairRequired: !!req.is_flair_required,
  };
  if (rules.status === "rejected" && about.status === "rejected") {
    info.rulesText = "(Rules could not be fetched. Be conservative: no self-promotion, disclose affiliation.)";
  } else {
    cache.set(name.toLowerCase(), { at: Date.now(), info });
  }
  return info;
}
