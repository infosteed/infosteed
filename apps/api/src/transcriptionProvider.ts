// SPDX-License-Identifier: AGPL-3.0-only
import { Readable } from "node:stream";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { ApiConfig } from "./config.js";

export interface NormalizedTranscript {
  text: string;
  language: string | null;
  languageProbability: number | null;
  durationMs: number | null;
  segments: Array<{ id: number; startMs: number; endMs: number; text: string }>;
  words: Array<{
    startMs: number;
    endMs: number;
    text: string;
    probability: number | null;
  }>;
}

export interface TranscriptionInput {
  openAudio: () => Promise<AsyncIterable<Uint8Array>>;
  byteSize: number;
  filename: string;
  contentType: string;
  model: string;
  language?: string;
  prompt?: string;
  signal?: AbortSignal;
}

export interface TranscriptionProvider {
  readonly enabled: boolean;
  readonly model: string;
  readonly maxUploadBytes: number;
  transcribe(input: TranscriptionInput): Promise<NormalizedTranscript>;
}

const providerWordSchema = z
  .object({
    word: z.string().optional(),
    text: z.string().optional(),
    start: z.number().nonnegative(),
    end: z.number().nonnegative(),
    probability: z.number().min(0).max(1).nullable().optional(),
  })
  .refine((word) => word.end >= word.start, "Word end precedes start");

const providerResponseSchema = z.object({
  text: z.string().default(""),
  language: z.string().nullable().optional(),
  language_probability: z.number().min(0).max(1).nullable().optional(),
  language_confidence: z.number().min(0).max(1).nullable().optional(),
  duration: z.number().nonnegative().nullable().optional(),
  segments: z
    .array(
      z
        .object({
          id: z.number().int().nonnegative().optional(),
          start: z.number().nonnegative(),
          end: z.number().nonnegative(),
          text: z.string(),
          words: z.array(providerWordSchema).optional(),
        })
        .refine(
          (segment) => segment.end >= segment.start,
          "Segment end precedes start",
        ),
    )
    .default([]),
  words: z.array(providerWordSchema).default([]),
});

function quoteHeaderValue(value: string): string {
  return value.replace(/["\r\n]/g, "_");
}

function field(boundary: string, name: string, value: string): Buffer {
  return Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
    "utf8",
  );
}

function multipartBody(
  input: TranscriptionInput,
  boundary: string,
  includeWords: boolean,
): Readable {
  async function* parts() {
    yield field(boundary, "model", input.model);
    yield field(boundary, "response_format", "verbose_json");
    yield field(boundary, "timestamp_granularities[]", "segment");
    if (includeWords)
      yield field(boundary, "timestamp_granularities[]", "word");
    if (input.language) yield field(boundary, "language", input.language);
    if (input.prompt) yield field(boundary, "prompt", input.prompt);
    yield Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${quoteHeaderValue(input.filename)}"\r\n` +
        `Content-Type: ${quoteHeaderValue(input.contentType)}\r\n\r\n`,
      "utf8",
    );
    for await (const chunk of await input.openAudio()) yield Buffer.from(chunk);
    yield Buffer.from(`\r\n--${boundary}--\r\n`, "utf8");
  }
  return Readable.from(parts());
}

function normalizeResponse(value: unknown): NormalizedTranscript {
  const parsed = providerResponseSchema.parse(value);
  const providerWords =
    parsed.words.length > 0
      ? parsed.words
      : parsed.segments.flatMap((segment) => segment.words ?? []);
  return {
    text: parsed.text.trim(),
    language: parsed.language ?? null,
    languageProbability:
      parsed.language_probability ?? parsed.language_confidence ?? null,
    durationMs:
      parsed.duration === null || parsed.duration === undefined
        ? null
        : Math.round(parsed.duration * 1000),
    segments: parsed.segments
      .map((segment, index) => ({
        id: segment.id ?? index,
        startMs: Math.round(segment.start * 1000),
        endMs: Math.round(segment.end * 1000),
        text: segment.text.trim(),
      }))
      .sort(
        (a, b) => a.startMs - b.startMs || a.endMs - b.endMs || a.id - b.id,
      ),
    words: providerWords
      .map((word) => ({
        startMs: Math.round(word.start * 1000),
        endMs: Math.round(word.end * 1000),
        text: (word.word ?? word.text ?? "").trim(),
        probability: word.probability ?? null,
      }))
      .filter((word) => word.text.length > 0)
      .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs),
  };
}

export class OpenAiCompatibleTranscriptionProvider implements TranscriptionProvider {
  readonly enabled = true;
  readonly model: string;
  readonly maxUploadBytes: number;

  constructor(
    private readonly options: {
      endpoint: string;
      apiKey?: string;
      model: string;
      timeoutMs: number;
      maxUploadBytes: number;
    },
  ) {
    this.model = options.model;
    this.maxUploadBytes = options.maxUploadBytes;
  }

  async transcribe(input: TranscriptionInput): Promise<NormalizedTranscript> {
    if (input.byteSize > this.maxUploadBytes) {
      throw new Error(
        `Audio asset is ${input.byteSize} bytes; provider limit is ${this.maxUploadBytes} bytes`,
      );
    }
    try {
      return await this.request(input, true);
    } catch (error) {
      if (!(error instanceof UnsupportedWordTimestampsError)) throw error;
      return this.request(input, false);
    }
  }

  private async request(
    input: TranscriptionInput,
    includeWords: boolean,
  ): Promise<NormalizedTranscript> {
    const boundary = `infosteed-${randomUUID()}`;
    const controller = new AbortController();
    const abort = () => controller.abort();
    input.signal?.addEventListener("abort", abort, { once: true });
    if (input.signal?.aborted) controller.abort();
    const timeout = setTimeout(
      () => controller.abort(),
      this.options.timeoutMs,
    );
    let response: Response;
    try {
      response = await fetch(
        this.options.endpoint.replace(/\/$/, "") + "/audio/transcriptions",
        {
          method: "POST",
          signal: controller.signal,
          headers: {
            "content-type": `multipart/form-data; boundary=${boundary}`,
            ...(this.options.apiKey
              ? { authorization: `Bearer ${this.options.apiKey}` }
              : {}),
          },
          body: multipartBody(
            input,
            boundary,
            includeWords,
          ) as unknown as BodyInit,
          duplex: "half",
        } as RequestInit & { duplex: "half" },
      );
    } finally {
      clearTimeout(timeout);
      input.signal?.removeEventListener("abort", abort);
    }
    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).slice(0, 500);
      if (
        includeWords &&
        response.status === 400 &&
        /word|timestamp|granular/i.test(detail)
      ) {
        throw new UnsupportedWordTimestampsError();
      }
      throw new Error(
        `Transcription provider failed with ${response.status}${detail ? `: ${detail}` : ""}`,
      );
    }
    return normalizeResponse(await response.json());
  }
}

class UnsupportedWordTimestampsError extends Error {}

export function createTranscriptionProvider(
  config: ApiConfig,
): TranscriptionProvider | undefined {
  if (!config.TRANSCRIPTION_ENDPOINT) return undefined;
  return new OpenAiCompatibleTranscriptionProvider({
    endpoint: config.TRANSCRIPTION_ENDPOINT,
    apiKey: config.TRANSCRIPTION_API_KEY,
    model: config.TRANSCRIPTION_MODEL,
    timeoutMs: config.TRANSCRIPTION_TIMEOUT_MS,
    maxUploadBytes: config.TRANSCRIPTION_MAX_UPLOAD_BYTES,
  });
}
