import { createLimitedFetch, type GeminiClientConfig } from "@aipk/pipeline";
import type { Env } from "../config/env.js";

/**
 * Single limiter instance per process, shared across every Gemini call this
 * backend makes: a kit's 4-category fan-out AND every concurrently-running
 * kit's generation job. This is the fix for the gap flagged in Phase 3/4 —
 * gemini-client.ts's retry/backoff only reacts after a 429 already
 * happened, it never capped how many requests could be in flight at once.
 * createLimitedFetch (pipeline/src/generation/gemini-rate-limit.ts) wraps
 * the fetch implementation itself, so every pipeline function that takes a
 * GeminiClientConfig is throttled for free, with no pipeline changes. The
 * CLI creates its own separate instance of the same helper for its own
 * process — they can't share a limiter across process boundaries.
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
