import { afterEach, describe, expect, it, vi } from "vitest";
import { validateKit } from "../../schema/kit.js";
import { generateKit } from "../generate-kit.js";
import { PipelineError } from "../errors.js";

afterEach(() => vi.unstubAllGlobals());

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, url: "", headers: { get: () => "text/html" }, text: async () => "", json: async () => body } as unknown as Response;
}

function htmlResponse(html: string, url: string): Response {
  return {
    ok: true,
    status: 200,
    url,
    headers: { get: (k: string) => (k.toLowerCase() === "content-type" ? "text/html" : null) },
    text: async () => html,
    body: {
      getReader() {
        let sent = false;
        return {
          async read() {
            if (sent) return { done: true, value: undefined };
            sent = true;
            return { done: false, value: new TextEncoder().encode(html) };
          },
          async cancel() {},
        };
      },
    },
  } as unknown as Response;
}

function geminiTextResponse(payload: unknown): Response {
  return jsonResponse({ candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }] });
}

function stubGlobalFetch(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.includes("generativelanguage.googleapis.com")) {
        const body = JSON.parse((init!.body as string) ?? "{}");
        const sys: string = body.systemInstruction.parts[0].text;
        const prompt: string = body.contents[0].parts[0].text;

        if (sys.includes("extract job requirements")) {
          return geminiTextResponse({ requirements: [{ text: "5+ years with React", kind: "technical", priority: "must" }] });
        }
        if (sys.includes("company brief")) {
          return geminiTextResponse({ summary: "Acme builds widgets.", what_they_do: "Widget manufacturing SaaS." });
        }
        if (sys.includes("interview questions for the")) {
          const idMatch = prompt.match(/\[r\d+\]/);
          const reqId = idMatch ? idMatch[0].slice(1, -1) : undefined;
          return geminiTextResponse({
            questions: reqId
              ? [{ requirement_ids: [reqId], prompt: "Discuss your React experience", answer_outline: "Cover component design.", difficulty: 2 }]
              : [],
          });
        }
        if (sys.includes("flashcards")) {
          return geminiTextResponse({ flashcards: [{ front: "React?", back: "A UI library.", requirement_ids: [] }] });
        }
        return geminiTextResponse({});
      }

      if (url.endsWith("/robots.txt")) return jsonResponse({}, false, 404);
      if (url.startsWith("https://html.duckduckgo.com")) return htmlResponse("<html><body>no results</body></html>", url);
      if (url === "https://acme.example/") {
        return htmlResponse('<html><head><title>Acme</title></head><body><a href="/careers">Careers</a></body></html>', url);
      }
      if (url === "https://acme.example/careers") {
        return htmlResponse("<html><head><title>Careers</title></head><body>We hire great engineers.</body></html>", url);
      }
      return jsonResponse({}, false, 404);
    }),
  );
}

const BASE_INPUT = { jd: "Senior Backend Engineer\n\nRequired: 5+ years with React.", companyUrl: "https://acme.example/", days: 3 };

describe("generateKit", () => {
  it("runs the full pipeline end-to-end and returns a kit that passes validateKit", async () => {
    stubGlobalFetch();

    const stages: string[] = [];
    const result = await generateKit(
      BASE_INPUT,
      { geminiConfig: { apiKey: "key" }, urlValidatorOptions: { blockPrivateNetworks: false } },
      (stage) => {
        stages.push(stage);
      },
    );

    expect(stages).toEqual(["researching", "generating", "checking"]);
    expect(validateKit(result.kit).ok).toBe(true);
    expect(result.kit.role.requirements.length).toBeGreaterThan(0);
    expect(result.kit.schedule.days).toHaveLength(3);
    expect(result.researchPages.length).toBeGreaterThan(0);
  });

  it("throws PipelineError with COMPANY_UNREACHABLE when the URL is blocked, before any generation happens", async () => {
    const fetchImpl = vi.fn();

    await expect(
      generateKit(
        { ...BASE_INPUT, companyUrl: "http://127.0.0.1/internal" },
        { geminiConfig: { apiKey: "key", fetchImpl }, urlValidatorOptions: { blockPrivateNetworks: true } },
      ),
    ).rejects.toMatchObject({ code: "COMPANY_UNREACHABLE" });

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("throws a real PipelineError instance, not a plain object", async () => {
    try {
      await generateKit(
        { ...BASE_INPUT, companyUrl: "http://127.0.0.1/internal" },
        { geminiConfig: { apiKey: "key" }, urlValidatorOptions: { blockPrivateNetworks: true } },
      );
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(PipelineError);
    }
  });
});
