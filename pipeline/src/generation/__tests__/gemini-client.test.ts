import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { GeminiUnavailableError, generateJson } from "../gemini-client.js";

function geminiResponse(text: string, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }),
  } as unknown as Response;
}

const schema = z.object({ value: z.string() });

describe("generateJson", () => {
  it("throws GeminiUnavailableError immediately when no API key is configured, without calling fetch", async () => {
    const fetchImpl = vi.fn();
    await expect(
      generateJson({ apiKey: undefined, fetchImpl }, { systemInstruction: "sys", prompt: "p" }, (r) => schema.parse(r)),
    ).rejects.toThrow(GeminiUnavailableError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("retries on 429 then succeeds", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 429 } as Response)
      .mockResolvedValueOnce(geminiResponse(JSON.stringify({ value: "ok" })));

    const result = await generateJson(
      { apiKey: "key", fetchImpl, maxRetries: 2 },
      { systemInstruction: "sys", prompt: "p" },
      (r) => schema.parse(r),
    );
    expect(result).toEqual({ value: "ok" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("retries on invalid JSON in the response text then succeeds", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(geminiResponse("not valid json"))
      .mockResolvedValueOnce(geminiResponse(JSON.stringify({ value: "ok" })));

    const result = await generateJson(
      { apiKey: "key", fetchImpl, maxRetries: 2 },
      { systemInstruction: "sys", prompt: "p" },
      (r) => schema.parse(r),
    );
    expect(result).toEqual({ value: "ok" });
  });

  it("retries when the parsed JSON fails schema validation, then succeeds", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(geminiResponse(JSON.stringify({ wrong_field: 1 })))
      .mockResolvedValueOnce(geminiResponse(JSON.stringify({ value: "ok" })));

    const result = await generateJson(
      { apiKey: "key", fetchImpl, maxRetries: 2 },
      { systemInstruction: "sys", prompt: "p" },
      (r) => schema.parse(r),
    );
    expect(result).toEqual({ value: "ok" });
  });

  it("gives up and throws GeminiUnavailableError after exhausting retries", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 500 } as Response);

    await expect(
      generateJson({ apiKey: "key", fetchImpl, maxRetries: 2 }, { systemInstruction: "sys", prompt: "p" }, (r) =>
        schema.parse(r),
      ),
    ).rejects.toThrow(GeminiUnavailableError);
    expect(fetchImpl).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it("does not retry on a non-retriable client error (e.g. 400 bad request)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 400 } as Response);

    await expect(
      generateJson({ apiKey: "key", fetchImpl, maxRetries: 3 }, { systemInstruction: "sys", prompt: "p" }, (r) =>
        schema.parse(r),
      ),
    ).rejects.toThrow(GeminiUnavailableError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("sends the model, system instruction, prompt, and JSON response mode in the request body", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(geminiResponse(JSON.stringify({ value: "ok" })));

    await generateJson(
      { apiKey: "key", model: "gemini-2.5-flash", fetchImpl },
      { systemInstruction: "be nice", prompt: "hello" },
      (r) => schema.parse(r),
    );

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toContain("gemini-2.5-flash");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.systemInstruction.parts[0].text).toBe("be nice");
    expect(body.contents[0].parts[0].text).toBe("hello");
    expect(body.generationConfig.responseMimeType).toBe("application/json");
  });
});
