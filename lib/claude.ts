import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { CREATIVITY, TEST_MODEL, modelInfo, type Creativity } from "@/lib/models";
import { HttpError } from "@/lib/errors";

// All Claude calls happen server-side. The key is decrypted per call and never leaves the server.

export async function clientFor(workspaceId: string): Promise<Anthropic> {
  const s = await db.settings.findUnique({ where: { workspaceId } });
  if (!s?.claudeKeyEnc) throw new HttpError(400, "Add your Claude API key in Claude API & accounts first");
  return new Anthropic({ apiKey: decrypt(s.claudeKeyEnc), maxRetries: 2 });
}

export type ToolCallResult<T> = {
  input: T;
  model: string;
  tokensIn: number;
  tokensOut: number;
};

/**
 * One structured call: Claude must answer by calling `tool`. How that is enforced depends on
 * the model (see lib/models.ts): forced tool_choice where supported, otherwise tool_choice
 * auto + strict schema + an explicit instruction, with one retry if no tool call comes back.
 */
export async function callTool<T>(opts: {
  client: Anthropic;
  model: string;
  system: string;
  user: string;
  tool: Anthropic.Tool;
  creativity?: Creativity;
  maxTokens?: number;
}): Promise<ToolCallResult<T>> {
  const info = modelInfo(opts.model);
  const tool: Anthropic.Tool = info.forcedToolChoice ? opts.tool : { ...opts.tool, strict: true };
  const system = info.forcedToolChoice
    ? opts.system
    : `${opts.system}\n\nAnswer only by calling the ${tool.name} tool exactly once. Do not reply with plain text.`;

  const params: Anthropic.MessageCreateParamsNonStreaming = {
    model: info.id,
    max_tokens: opts.maxTokens ?? 16000,
    system,
    messages: [{ role: "user", content: opts.user }],
    tools: [tool],
    tool_choice: info.forcedToolChoice ? { type: "tool", name: tool.name } : { type: "auto" },
  };
  if (info.supportsTemperature) params.temperature = CREATIVITY[opts.creativity ?? "balanced"].temperature;
  if (info.thinking === "disable") params.thinking = { type: "disabled" };

  let tokensIn = 0;
  let tokensOut = 0;
  for (let attempt = 0; attempt < 2; attempt++) {
    let res: Anthropic.Message;
    try {
      res = await opts.client.messages.create(params);
    } catch (e) {
      throw mapError(e);
    }
    tokensIn += res.usage.input_tokens;
    tokensOut += res.usage.output_tokens;
    if (res.stop_reason === "refusal") throw new HttpError(422, "Claude declined to write this draft. Try rephrasing the brief.");
    const block = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === tool.name);
    if (block && res.stop_reason !== "max_tokens") {
      return { input: block.input as T, model: info.id, tokensIn, tokensOut };
    }
    if (res.stop_reason === "max_tokens") params.max_tokens = Math.min(32000, (params.max_tokens ?? 16000) * 2);
  }
  throw new HttpError(502, "Claude did not return a structured draft. Try again.");
}

export function mapError(e: unknown): Error {
  if (e instanceof Anthropic.AuthenticationError) return new HttpError(401, "Claude rejected the API key. Check it in Claude API & accounts.");
  if (e instanceof Anthropic.PermissionDeniedError) return new HttpError(403, "This API key cannot use the selected model.");
  if (e instanceof Anthropic.NotFoundError) return new HttpError(400, "Model not found. Pick another model in Claude API & accounts.");
  if (e instanceof Anthropic.RateLimitError) return new HttpError(429, "Claude rate limit reached. Wait a minute and try again.");
  if (e instanceof Anthropic.BadRequestError) return new HttpError(400, `Claude rejected the request: ${e.message}`);
  if (e instanceof Anthropic.APIError) return new HttpError(502, `Claude API error (${e.status ?? "network"}): ${e.message}`);
  return e instanceof Error ? e : new Error(String(e));
}

/** Test connection: the smallest possible Messages API call. */
export async function testKey(apiKey: string): Promise<void> {
  const client = new Anthropic({ apiKey, maxRetries: 0 });
  try {
    await client.messages.create({ model: TEST_MODEL, max_tokens: 8, messages: [{ role: "user", content: "ping" }] });
  } catch (e) {
    throw mapError(e);
  }
}
