import { backoffDelayMs } from "../retrieval/rate-limit.js";

export const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

/** Thrown when Gemini could not produce a usable result even after retries, or no key is configured. Callers catch this and fall back to a deterministic heuristic. */
export class GeminiUnavailableError extends Error {}

/** Internal: signals a retriable failure (rate limit, server error, invalid/unparseable JSON). Never escapes generateJson(). */
class RetriableGeminiError extends Error {}

export interface GeminiClientConfig {
  apiKey?: string;
  model?: string;
  fetchImpl?: typeof fetch;
  maxRetries?: number;
}

export interface GenerateJsonRequest {
  systemInstruction: string;
  prompt: string;
  responseSchema?: Record<string, unknown>;
  temperature?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callGeminiOnce(
  apiKey: string,
  model: string,
  fetchImpl: typeof fetch,
  request: GenerateJsonRequest,
): Promise<unknown> {
  const url = `${GEMINI_API_BASE}/${model}:generateContent?key=${apiKey}`;
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: request.systemInstruction }] },
      contents: [{ role: "user", parts: [{ text: request.prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        temperature: request.temperature ?? 0.3,
        ...(request.responseSchema ? { responseSchema: request.responseSchema } : {}),
      },
    }),
  });

  if (res.status === 429 || res.status >= 500) {
    throw new RetriableGeminiError(`gemini request failed with status ${res.status}`);
  }
  if (!res.ok) {
    throw new GeminiUnavailableError(`gemini request failed with status ${res.status}`);
  }

  const body = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = body.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof text !== "string" || text.length === 0) {
    throw new RetriableGeminiError("gemini response contained no text");
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new RetriableGeminiError("gemini response was not valid JSON");
  }
}

/**
 * Calls Gemini and returns parsed+validated JSON. Retries on rate limits
 * (429), server errors (5xx), invalid/unparseable JSON, and schema
 * validation failures, with exponential backoff+jitter (reusing
 * retrieval/rate-limit.ts's backoffDelayMs rather than a second copy of
 * that logic). Any other failure — including no API key at all — throws
 * GeminiUnavailableError, which callers catch to run their deterministic
 * heuristic fallback instead.
 */
export async function generateJson<T>(
  config: GeminiClientConfig,
  request: GenerateJsonRequest,
  validate: (raw: unknown) => T,
): Promise<T> {
  if (!config.apiKey) {
    throw new GeminiUnavailableError("no GEMINI_API_KEY configured");
  }

  const model = config.model ?? DEFAULT_GEMINI_MODEL;
  const fetchImpl = config.fetchImpl ?? fetch;
  const maxRetries = config.maxRetries ?? 3;

  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const raw = await callGeminiOnce(config.apiKey, model, fetchImpl, request);
      try {
        return validate(raw);
      } catch (validationErr) {
        throw new RetriableGeminiError(
          `gemini response failed schema validation: ${(validationErr as Error).message}`,
        );
      }
    } catch (err) {
      lastError = err;
      const retriable = err instanceof RetriableGeminiError;
      if (!retriable) throw err;
      if (attempt === maxRetries) {
        throw new GeminiUnavailableError(
          `gemini unavailable after ${attempt + 1} attempt(s): ${(err as Error).message}`,
        );
      }
      await sleep(backoffDelayMs(attempt));
    }
  }
  throw lastError;
}
