import { describe, expect, it } from "vitest";
import { fetchTextCapped } from "../http-safety.js";

function streamedResponse(chunks: string[], headers: Record<string, string> = {}): Response {
  return {
    ok: true,
    status: 200,
    url: "https://example.com/",
    headers: { get: (key: string) => headers[key.toLowerCase()] ?? null },
    body: {
      getReader() {
        let i = 0;
        return {
          async read() {
            if (i >= chunks.length) return { done: true, value: undefined };
            const value = new TextEncoder().encode(chunks[i]);
            i++;
            return { done: false, value };
          },
          async cancel() {},
        };
      },
    },
  } as unknown as Response;
}

describe("fetchTextCapped", () => {
  it("returns the body text on a normal successful response", async () => {
    const fetchImpl = (async () => streamedResponse(["hello ", "world"])) as typeof fetch;
    const result = await fetchTextCapped("https://example.com/", { fetchImpl });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.text).toBe("hello world");
  });

  it("cuts off a response whose actual streamed body exceeds the byte cap, even with no content-length header", async () => {
    const fetchImpl = (async () => streamedResponse(["x".repeat(50), "y".repeat(50)])) as typeof fetch;
    const result = await fetchTextCapped("https://example.com/", { fetchImpl, maxBytes: 60 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason.type).toBe("too_large");
  });

  it("rejects based on a declared content-length over the cap without reading the body", async () => {
    const fetchImpl = (async () => streamedResponse(["small"], { "content-length": "999999" })) as typeof fetch;
    const result = await fetchTextCapped("https://example.com/", { fetchImpl, maxBytes: 100 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason.type).toBe("too_large");
  });

  it("rejects a content type that doesn't match what was required", async () => {
    const fetchImpl = (async () => streamedResponse(["{}"], { "content-type": "application/json" })) as typeof fetch;
    const result = await fetchTextCapped("https://example.com/", { fetchImpl, requireContentTypeIncludes: "text/html" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason.type).toBe("content_type_mismatch");
  });

  it("reports a non-ok http status", async () => {
    const fetchImpl = (async () => ({ ok: false, status: 404, headers: { get: () => null } }) as unknown as Response) as typeof fetch;
    const result = await fetchTextCapped("https://example.com/", { fetchImpl });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toEqual({ type: "http_status", status: 404 });
  });

  it("reports a network error (including a timeout abort) as network_error, not a throw", async () => {
    const fetchImpl = (async () => {
      throw new Error("fetch failed");
    }) as typeof fetch;
    const result = await fetchTextCapped("https://example.com/", { fetchImpl });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason.type).toBe("network_error");
    }
  });

  it("aborts a request that takes longer than the timeout", async () => {
    const fetchImpl = ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      })) as typeof fetch;

    const result = await fetchTextCapped("https://example.com/", { fetchImpl, timeoutMs: 20 });
    expect(result.ok).toBe(false);
  });
});
