import { createConcurrencyLimiter } from "../retrieval/rate-limit.js";

/**
 * wraps fetch itself with a limit on how many calls run at once, so every
 * pipeline call using the result as its fetchImpl shares one cap on gemini
 * requests in flight. that covers a kit's four question categories running
 * together, and every kit or batch case running in the same process. each
 * process, the backend server or a cli run, makes its own instance since a
 * limit can't be shared across processes. that's fine, each one only needs
 * to watch its own share of the free tier.
 */
export function createLimitedFetch(maxConcurrent: number): typeof fetch {
  const limiter = createConcurrencyLimiter(maxConcurrent);
  return ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
    limiter(() => fetch(input, init))) as typeof fetch;
}
