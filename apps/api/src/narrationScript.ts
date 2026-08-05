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

type RewriteInput = {
  outputLocale: OutputLocale;
  cues: VoiceoverCueInput[];
  style: "concise" | "natural" | "instructional";
  speed?: number;
};

type TimedCue = VoiceoverCueInput & { maxWords: number };

class InvalidModelOutputError extends Error {}

function maxWordsForCue(cue: VoiceoverCueInput, speed: number): number {
  // 150 words per minute is one word every 400 ms at normal speed.
  return Math.max(
    1,
    Math.floor(((cue.sourceEndMs - cue.sourceStartMs) * speed) / 400),
  );
}

function countWords(text: string): number {
  return text.trim().split(/\s+/u).filter(Boolean).length;
}

function normalizeText(text: string): string {
  return text
    .normalize("NFKC")
    .toLocaleLowerCase("en")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/gu, " ");
}

function tokenOverlap(left: string, right: string): number {
  const leftCounts = new Map<string, number>();
  const rightCounts = new Map<string, number>();
  for (const token of normalizeText(left).split(" ").filter(Boolean))
    leftCounts.set(token, (leftCounts.get(token) ?? 0) + 1);
  for (const token of normalizeText(right).split(" ").filter(Boolean))
    rightCounts.set(token, (rightCounts.get(token) ?? 0) + 1);
  const leftTotal = [...leftCounts.values()].reduce(
    (sum, count) => sum + count,
    0,
  );
  const rightTotal = [...rightCounts.values()].reduce(
    (sum, count) => sum + count,
    0,
  );
  if (leftTotal === 0 || rightTotal === 0) return 0;
  let shared = 0;
  for (const [token, count] of leftCounts)
    shared += Math.min(count, rightCounts.get(token) ?? 0);
  return shared / Math.max(leftTotal, rightTotal);
}

function extractJson(value: string): unknown {
  const trimmed = value
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match && trimmed.includes("{"))
      throw new InvalidModelOutputError(
        "The local model returned malformed narration JSON",
      );
    if (!match)
      throw new InvalidModelOutputError(
        "The local model did not return a narration script",
      );
    try {
      return JSON.parse(match[0]);
    } catch {
      throw new InvalidModelOutputError(
        "The local model returned malformed narration JSON",
      );
    }
  }
}

function validateRewrite(
  source: TimedCue[],
  value: unknown,
): { cues?: VoiceoverCueInput[]; problems: string[] } {
  const parsed = outputSchema.safeParse(value);
  if (!parsed.success)
    return {
      problems: ["Return valid JSON containing a non-empty cues array."],
    };

  const problems: string[] = [];
  if (parsed.data.cues.length !== source.length)
    problems.push(`Return exactly ${source.length} cues.`);

  const seen = new Set<string>();
  parsed.data.cues.forEach((cue, index) => {
    if (seen.has(cue.id)) problems.push(`Cue id ${cue.id} is duplicated.`);
    seen.add(cue.id);
    if (cue.id !== source[index]?.id)
      problems.push(`Cue ${index + 1} must have id ${source[index]?.id}.`);
    if (!/[\p{L}\p{N}]/u.test(cue.text))
      problems.push(`Cue ${cue.id} must contain spoken words.`);
    const limit = source[index]?.maxWords;
    if (limit !== undefined && countWords(cue.text) > limit)
      problems.push(`Cue ${cue.id} must contain at most ${limit} words.`);
  });

  if (parsed.data.cues.length === source.length) {
    const unchanged = parsed.data.cues.filter(
      (cue, index) =>
        normalizeText(cue.text) === normalizeText(source[index].text),
    ).length;
    const combinedSource = source.map((cue) => cue.text).join(" ");
    const combinedOutput = parsed.data.cues.map((cue) => cue.text).join(" ");
    if (unchanged / source.length >= 0.7)
      problems.push(
        "Rewrite the captions substantially instead of copying them.",
      );
    else if (tokenOverlap(combinedSource, combinedOutput) >= 0.9)
      problems.push("Use substantially different, polished narration wording.");
  }

  if (problems.length > 0) return { problems: [...new Set(problems)] };
  return {
    problems: [],
    cues: source.map((cue, index) => ({
      id: cue.id,
      sourceStartMs: cue.sourceStartMs,
      sourceEndMs: cue.sourceEndMs,
      text: parsed.data.cues[index].text,
    })),
  };
}

function promptMessages(
  input: RewriteInput,
  cues: TimedCue[],
  correction?: string,
) {
  const styleGuidance = {
    concise:
      "Use direct, economical wording and remove all unnecessary detail.",
    natural:
      "Use clear, conversational wording suitable for a polished tutorial.",
    instructional:
      "Use direct instructional wording that tells the viewer what to do.",
  }[input.style];
  const requirements = [
    "Return exactly one result for every supplied cue id, in the same order.",
    "Rewrite substantially instead of copying the captions.",
    "Correct transcription errors, spacing, punctuation, repetition, filler, and false starts.",
    "Preserve the spelling of known product names and interface labels in their original language.",
    'Correct malformed transcription such as "U .S." to "U.S." and "pre -populated" to "pre-populated".',
    "Never return an ellipsis or punctuation-only cue.",
    "Give every cue a useful, non-empty spoken line.",
    "Stay within each cue's maxWords limit.",
    'Do not leave conjunctions such as "and", "but", "if", or "to" dangling at the end of a cue.',
    "Prefer complete sentences that flow naturally into the next cue.",
    "Describe only information supported by the captions; do not invent interface behavior.",
    'Return only valid JSON shaped exactly as {"cues":[{"id":"original id","text":"rewritten narration"}]}.',
  ];
  const correctionText = correction
    ? `\nYour previous response was rejected. Correct every issue below:\n${correction}`
    : "";
  return [
    {
      role: "system" as const,
      content:
        "You edit automatic captions into professional spoken tutorial narration. Return only valid JSON. Do not explain or analyse the task.",
    },
    {
      role: "user" as const,
      content: [
        "Rewrite the complete caption track as concise, natural narration.",
        `Write all narration in ${OUTPUT_LOCALE_NAMES[input.outputLocale]}. Preserve product names and application control labels in their original language.`,
        `Style: ${input.style}. ${styleGuidance}`,
        "Requirements:",
        ...requirements.map((requirement) => `- ${requirement}`),
        correctionText,
        "Cues:",
        JSON.stringify(
          cues.map((cue) => ({
            id: cue.id,
            maxWords: cue.maxWords,
            text: cue.text,
          })),
        ),
      ].join("\n"),
    },
  ];
}

async function requestRewrite(
  config: ApiConfig,
  input: RewriteInput,
  cues: TimedCue[],
  fetcher: typeof fetch,
  correction?: string,
): Promise<unknown> {
  const controller = AbortSignal.timeout(config.AI_SCRIPT_TIMEOUT_MS);
  const base = config.AI_ENDPOINT!.replace(/\/$/, "");
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
                options: { temperature: 0.1, num_predict: maxTokens },
                messages: promptMessages(input, cues, correction),
              }
            : {
                model: config.AI_MODEL,
                temperature: 0.1,
                max_tokens: maxTokens,
                response_format: { type: "json_object" },
                messages: promptMessages(input, cues, correction),
              },
        ),
        signal: controller,
      },
    );
  } catch (error) {
    if (controller.aborted)
      throw Object.assign(
        new Error(
          `The local model did not finish rewriting the captions within ${Math.round(config.AI_SCRIPT_TIMEOUT_MS / 1_000)} seconds. Increase AI_SCRIPT_TIMEOUT_MS for slower hardware.`,
        ),
        { statusCode: 504 },
      );
    throw error;
  }
  if (!response.ok)
    throw new Error(`Local script model returned HTTP ${response.status}`);
  const body = (await response.json()) as {
    message?: { content?: string; thinking?: string };
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = ollama
    ? body.message?.content
    : body.choices?.[0]?.message?.content;
  if (!content)
    throw new InvalidModelOutputError(
      body.message?.thinking
        ? "The local model used its output budget for reasoning and returned no narration. Configure a non-thinking instruct model."
        : "The local model returned an empty narration script",
    );
  try {
    return extractJson(content);
  } catch (error) {
    if (error instanceof InvalidModelOutputError) throw error;
    throw new InvalidModelOutputError(
      "The local model returned malformed narration JSON",
    );
  }
}

export async function rewriteNarrationScript(
  config: ApiConfig,
  input: RewriteInput,
  fetcher: typeof fetch = fetch,
): Promise<VoiceoverCueInput[]> {
  if (!config.AI_ENDPOINT || !config.AI_MODEL)
    throw Object.assign(new Error("A local language model is not configured"), {
      statusCode: 503,
    });

  const cues = input.cues.map((cue) => ({
    ...cue,
    maxWords: maxWordsForCue(cue, input.speed ?? 1),
  }));
  let problems: string[] = [];
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const value = await requestRewrite(
        config,
        input,
        cues,
        fetcher,
        attempt === 1
          ? problems.map((problem) => `- ${problem}`).join("\n")
          : undefined,
      );
      const result = validateRewrite(cues, value);
      if (result.cues) return result.cues;
      problems = result.problems;
    } catch (error) {
      if (!(error instanceof InvalidModelOutputError)) throw error;
      problems = [error instanceof Error ? error.message : String(error)];
    }
  }
  throw Object.assign(
    new Error(
      `The local model could not produce a usable narration script after two attempts: ${problems.join(" ")}`,
    ),
    { statusCode: 502 },
  );
}
