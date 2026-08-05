// SPDX-License-Identifier: AGPL-3.0-only
import { z } from "zod";
import {
  OUTPUT_LOCALE_NAMES,
  type OutputLocale,
  type VoiceoverCueInput,
} from "@infosteed/shared";
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
    outputLocale: OutputLocale;
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
    "/no_think",
    "Rewrite caption cues into a polished spoken narration script.",
    `Write all narration in ${OUTPUT_LOCALE_NAMES[input.outputLocale]}. Preserve literal product names and application control labels in their original language.`,
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
    "/no_think",
  ].join("\n");
  const controller = AbortSignal.timeout(config.AI_SCRIPT_TIMEOUT_MS);
  const base = config.AI_ENDPOINT.replace(/\/$/, "");
  const ollama = config.AI_PROVIDER === "ollama";
  const maxTokens = Math.min(8_192, Math.max(1_024, input.cues.length * 96));
  let response: Response;
  try {
    response = await fetcher(
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
                think: false,
                options: { temperature: 0.2, num_predict: maxTokens },
                messages: [{ role: "user", content: prompt }],
              }
            : {
                model: config.AI_MODEL,
                temperature: 0.2,
                max_tokens: maxTokens,
                response_format: { type: "json_object" },
                messages: [{ role: "user", content: prompt }],
              },
        ),
        signal: controller,
      },
    );
  } catch (error) {
    if (controller.aborted) {
      throw Object.assign(
        new Error(
          `The local model did not finish rewriting the captions within ${Math.round(config.AI_SCRIPT_TIMEOUT_MS / 1_000)} seconds. Increase AI_SCRIPT_TIMEOUT_MS for slower hardware.`,
        ),
        { statusCode: 504 },
      );
    }
    throw error;
  }
  if (!response.ok)
    throw new Error(`Local script model returned HTTP ${response.status}`);
  const body = (await response.json()) as {
    message?: { content?: string; thinking?: string };
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = ollama
    ? body.message?.content || body.message?.thinking
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
