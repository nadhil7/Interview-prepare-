import { createConcurrencyLimiter } from "../retrieval/rate-limit.js";

/**
 * Wraps `fetch` itself with a concurrency limiter, so every pipeline call
 * that's given the resulting function as its GeminiClientConfig.fetchImpl
 * shares one cap on in-flight Gemini requests — a kit's 4-category fan-out,
 * and (whoever calls this) every concurrently-running kit/case in that
 * process. Each process (backend server, CLI run) creates its own instance;
 * they can't share a limiter across process boundaries, which is fine —
 * each just needs its own cap on its own free-tier usage.
 */
export function createLimitedFetch(maxConcurrent: number): typeof fetch {
  const limiter = createConcurrencyLimiter(maxConcurrent);
  return ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
    limiter(() => fetch(input, init))) as typeof fetch;
}
