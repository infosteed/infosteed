// SPDX-License-Identifier: AGPL-3.0-only
import { z } from "zod";
import type { VoiceoverCueInput } from "@infosteed/shared";
import type { ApiConfig } from "./config.js";

const outputSchema = z.object({
  cues: z.array(
    z.object({ id: z.string(), text: z.string().trim().min(1).max(2_000) }),
  ),
});

function extractJson(value: string): unknown {
  const trimmed = value
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match)
      throw new Error("The local model did not return a narration script");
    return JSON.parse(match[0]);
  }
}

export async function rewriteNarrationScript(
  config: ApiConfig,
  input: {
    cues: VoiceoverCueInput[];
    style: "concise" | "natural" | "instructional";
  },
  fetcher: typeof fetch = fetch,
): Promise<VoiceoverCueInput[]> {
  if (!config.AI_ENDPOINT || !config.AI_MODEL)
    throw Object.assign(new Error("A local language model is not configured"), {
      statusCode: 503,
    });
  const prompt = [
    "Rewrite caption cues into a polished spoken narration script.",
    `Style: ${input.style}. Keep each cue concise enough for its available time.`,
    "Preserve every cue id and cue count. Do not change timestamps. Do not add markdown.",
    'Return only JSON shaped as {"cues":[{"id":"...","text":"..."}]}.',
    JSON.stringify(
      input.cues.map((cue) => ({
        id: cue.id,
        availableMs: cue.sourceEndMs - cue.sourceStartMs,
        text: cue.text,
      })),
    ),
  ].join("\n");
  const controller = AbortSignal.timeout(config.AI_TIMEOUT_MS);
  const base = config.AI_ENDPOINT.replace(/\/$/, "");
  const ollama = config.AI_PROVIDER === "ollama";
  const response = await fetcher(
    ollama ? `${base}/api/chat` : `${base}/chat/completions`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(config.AI_API_KEY
          ? { authorization: `Bearer ${config.AI_API_KEY}` }
          : {}),
      },
      body: JSON.stringify(
        ollama
          ? {
              model: config.AI_MODEL,
              stream: false,
              format: "json",
              messages: [{ role: "user", content: prompt }],
            }
          : {
              model: config.AI_MODEL,
              temperature: 0.2,
              response_format: { type: "json_object" },
              messages: [{ role: "user", content: prompt }],
            },
      ),
      signal: controller,
    },
  );
  if (!response.ok)
    throw new Error(`Local script model returned HTTP ${response.status}`);
  const body = (await response.json()) as {
    message?: { content?: string };
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = ollama
    ? body.message?.content
    : body.choices?.[0]?.message?.content;
  if (!content)
    throw new Error("The local model returned an empty narration script");
  const parsed = outputSchema.parse(extractJson(content));
  const byId = new Map(parsed.cues.map((cue) => [cue.id, cue.text]));
  if (
    byId.size !== input.cues.length ||
    input.cues.some((cue) => !byId.has(cue.id))
  ) {
    throw new Error("The local model changed the narration cue structure");
  }
  return input.cues.map((cue) => ({ ...cue, text: byId.get(cue.id)! }));
}
