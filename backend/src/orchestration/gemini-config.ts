import { createConcurrencyLimiter, type GeminiClientConfig } from "@aipk/pipeline";
import type { Env } from "../config/env.js";

/**
 * Single limiter instance per process, shared across every Gemini call this
 * backend makes: a kit's 4-category fan-out AND every concurrently-running
 * kit's generation job. This is the fix for the gap flagged in Phase 3/4 —
 * gemini-client.ts's retry/backoff only reacts after a 429 already
 * happened, it never capped how many requests could be in flight at once.
 * Wrapping the fetch implementation itself (rather than changing any
 * pipeline call site) means every pipeline function that takes a
 * GeminiClientConfig is throttled for free, with no pipeline changes.
 */
const GEMINI_CONCURRENCY = 2;

const geminiLimiter = createConcurrencyLimiter(GEMINI_CONCURRENCY);

const sharedLimitedFetch: typeof fetch = ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
  geminiLimiter(() => fetch(input, init))) as typeof fetch;

export function buildGeminiConfig(env: Pick<Env, "GEMINI_API_KEY" | "GEMINI_MODEL">): GeminiClientConfig {
  return {
    apiKey: env.GEMINI_API_KEY,
    model: env.GEMINI_MODEL,
    fetchImpl: sharedLimitedFetch,
  };
}
