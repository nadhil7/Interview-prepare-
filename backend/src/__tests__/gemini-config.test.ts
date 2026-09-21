import { afterEach, describe, expect, it, vi } from "vitest";
import { buildGeminiConfig } from "../orchestration/gemini-config.js";

afterEach(() => vi.unstubAllGlobals());

/**
 * This is the fix for the gap flagged in Phase 3/4: before this, nothing
 * capped how many Gemini requests could be in flight at once — a kit's
 * 4-category fan-out fired via a bare Promise.all with zero throttling.
 * Proves the shared limiter actually bounds concurrency, not just that it
 * exists.
 */
describe("buildGeminiConfig — shared concurrency limiter", () => {
  it("caps concurrent fetch calls made through the returned fetchImpl", async () => {
    let active = 0;
    let maxObservedActive = 0;

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        active++;
        maxObservedActive = Math.max(maxObservedActive, active);
        await new Promise((resolve) => setTimeout(resolve, 30));
        active--;
        return {
          ok: true,
          status: 200,
          json: async () => ({ candidates: [{ content: { parts: [{ text: "{}" }] } }] }),
        } as unknown as Response;
      }),
    );

    const config = buildGeminiConfig({ GEMINI_API_KEY: "key", GEMINI_MODEL: "gemini-2.5-flash" });
    const fetchImpl = config.fetchImpl!;

    await Promise.all(
      Array.from({ length: 6 }, () =>
        fetchImpl("https://generativelanguage.googleapis.com/v1beta/models/x:generateContent?key=key", {
          method: "POST",
          body: "{}",
        }),
      ),
    );

    expect(maxObservedActive).toBeGreaterThan(1); // calls did overlap, not fully serialized
    expect(maxObservedActive).toBeLessThanOrEqual(2); // but never exceeded the configured cap
  });
});
