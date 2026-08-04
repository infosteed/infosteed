// SPDX-License-Identifier: AGPL-3.0-only
import type { ApiConfig } from "./config.js";

export interface TtsVoice {
  id: string;
  name: string;
  language: string | null;
}

export interface TtsProvider {
  readonly id: string;
  readonly model: string;
  readonly defaultVoice: string;
  listVoices(): Promise<TtsVoice[]>;
  synthesize(input: {
    text: string;
    voice: string;
    speed: number;
    signal?: AbortSignal;
  }): Promise<Buffer>;
}

function displayVoice(id: string): string {
  return id
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function createTtsProvider(
  config: ApiConfig,
  fetcher: typeof fetch = fetch,
): TtsProvider | undefined {
  if (!config.TTS_BASE_URL) return undefined;
  const voices = [
    ...new Set(
      config.TTS_VOICES.split(",")
        .map((voice) => voice.trim())
        .filter(Boolean),
    ),
  ];
  if (!voices.includes(config.TTS_DEFAULT_VOICE))
    voices.unshift(config.TTS_DEFAULT_VOICE);
  const endpoint = `${config.TTS_BASE_URL.replace(/\/$/, "")}/audio/speech`;

  return {
    id: "openai-compatible",
    model: config.TTS_MODEL,
    defaultVoice: config.TTS_DEFAULT_VOICE,
    async listVoices() {
      return voices.map((id) => ({
        id,
        name: displayVoice(id),
        language: null,
      }));
    },
    async synthesize(input) {
      if (!voices.includes(input.voice))
        throw new Error("The selected voice is not installed");
      const timeout = AbortSignal.timeout(config.TTS_TIMEOUT_MS);
      const signal = input.signal
        ? AbortSignal.any([input.signal, timeout])
        : timeout;
      const response = await fetcher(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(config.TTS_API_KEY
            ? { authorization: `Bearer ${config.TTS_API_KEY}` }
            : {}),
        },
        body: JSON.stringify({
          model: config.TTS_MODEL,
          voice: input.voice,
          input: input.text,
          speed: input.speed,
          response_format: "wav",
        }),
        signal,
      });
      if (!response.ok)
        throw new Error(`TTS provider failed with ${response.status}`);
      const declaredLength = Number(
        response.headers.get("content-length") ?? 0,
      );
      if (declaredLength > config.TTS_MAX_RESPONSE_BYTES)
        throw new Error("TTS response exceeded the configured size limit");
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.byteLength === 0)
        throw new Error("TTS provider returned empty audio");
      if (bytes.byteLength > config.TTS_MAX_RESPONSE_BYTES)
        throw new Error("TTS response exceeded the configured size limit");
      return bytes;
    },
  };
}
