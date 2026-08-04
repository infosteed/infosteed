// SPDX-License-Identifier: AGPL-3.0-only
import {
  OllamaNativeStepWriter,
  OpenAiCompatibleStepWriter,
  type AiStepWriterProvider,
} from "@infosteed/ai-step-writer";
import type { ApiConfig } from "./config.js";

export function createAiProvider(
  config: ApiConfig,
): AiStepWriterProvider | undefined {
  if (!config.AI_ENDPOINT || !config.AI_MODEL) return undefined;
  if (config.AI_PROVIDER === "ollama") {
    return new OllamaNativeStepWriter({
      endpoint: config.AI_ENDPOINT,
      model: config.AI_MODEL,
      timeoutMs: config.AI_TIMEOUT_MS,
    });
  }
  return new OpenAiCompatibleStepWriter({
    endpoint: config.AI_ENDPOINT,
    apiKey: config.AI_API_KEY,
    model: config.AI_MODEL,
    timeoutMs: config.AI_TIMEOUT_MS,
  });
}
