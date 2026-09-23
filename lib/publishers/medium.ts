import { jsonOrThrow, PublishError, type Publisher } from "@/lib/publishers/types";

// Medium legacy integration tokens (no new tokens are issued). Posts go in as drafts.
export const mediumPublisher: Publisher = {
  platform: "medium",
  canAutoPublish: (a) => !!a && a.row.status === "connected",
  validate(d) {
    const e: string[] = [];
    if (!d.title?.trim()) e.push("Medium articles need a title");
    if (d.hashtags.length > 5) e.push("Medium allows at most 5 topics");
    return e;
  },
  async publish(d, images, account, token) {
    const userId = account.meta.userId as string;
    if (!userId) throw new PublishError("Medium user id missing; re-add the token", false);
    const header = images.find((i) => i.mimeType.startsWith("image/"))?.urls[0];
    const content = [`# ${d.title}`, d.subtitle ? `## ${d.subtitle}` : "", header ? `![](${header})` : "", d.body ?? ""].filter(Boolean).join("\n\n");
    const res = await fetch(`https://api.medium.com/v1/users/${userId}/posts`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ title: d.title, contentFormat: "markdown", content, tags: d.hashtags.slice(0, 5), publishStatus: "draft" }),
    });
    const body = await jsonOrThrow(res, "Medium post");
    return { externalId: body.data?.id, url: body.data?.url };
  },
};

export async function verifyMediumToken(token: string) {
  const res = await fetch("https://api.medium.com/v1/me", { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
  const body = await jsonOrThrow(res, "Medium token check");
  return body.data as { id: string; username: string; name: string; url: string };
}
