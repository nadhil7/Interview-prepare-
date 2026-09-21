import { createLimitedFetch, type GeminiClientConfig } from "@aipk/pipeline";
import type { Env } from "../config/env.js";

/**
 * one limiter for the whole process, shared across every gemini call this
 * backend makes, a kit's four question categories and every generation
 * job running at the same time. gemini client's retry logic only reacts
 * once a request has already been rate limited, it never caps how many
 * requests can be in flight at once. createLimitedFetch wraps the fetch
 * call itself, so every pipeline function using this config gets
 * throttled automatically with no changes needed in the pipeline. the
 * cli makes its own separate instance of the same helper for its own
 * process, since a limiter cannot be shared across processes.
 */
const GEMINI_CONCURRENCY = 2;

const sharedLimitedFetch = createLimitedFetch(GEMINI_CONCURRENCY);

export function buildGeminiConfig(env: Pick<Env, "GEMINI_API_KEY" | "GEMINI_MODEL">): GeminiClientConfig {
  return {
    apiKey: env.GEMINI_API_KEY,
    model: env.GEMINI_MODEL,
    fetchImpl: sharedLimitedFetch,
  };
}
