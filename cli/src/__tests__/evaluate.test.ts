import { validateKit } from "@aipk/pipeline";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { evaluate } from "../index.js";

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "aipk-cli-test-"));
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await rm(workDir, { recursive: true, force: true });
});

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
    vi.fn(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
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

async function writeInput(cases: unknown[]): Promise<{ inputPath: string; outputPath: string }> {
  const inputPath = join(workDir, "cases.json");
  const outputPath = join(workDir, "kits.json");
  await writeFile(inputPath, JSON.stringify(cases), "utf-8");
  return { inputPath, outputPath };
}

describe("evaluate", () => {
  it("produces one 'ok' entry per case with a kit that passes validateKit", async () => {
    stubGlobalFetch();
    const { inputPath, outputPath } = await writeInput([
      { id: "case-01", jd: "Senior Backend Engineer\n\nRequired: 5+ years with React.", company_url: "https://acme.example/", days: 3 },
    ]);

    await evaluate(inputPath, outputPath, 1);

    const output = JSON.parse(await readFile(outputPath, "utf-8"));
    expect(output.version).toBe("1.0");
    expect(typeof output.generated_at).toBe("string");
    expect(output.kits).toHaveLength(1);
    expect(output.kits[0].id).toBe("case-01");
    expect(output.kits[0].status).toBe("ok");
    expect(output.kits[0].error).toBeNull();
    expect(validateKit(output.kits[0].kit).ok).toBe(true);
  });

  it("continues past a failed case instead of aborting the run, and records it per Appendix B", async () => {
    stubGlobalFetch();
    const { inputPath, outputPath } = await writeInput([
      { id: "case-bad-url", jd: "Some JD with enough words to count as a requirement line", company_url: "ftp://acme.example/", days: 3 },
      { id: "case-good", jd: "Senior Backend Engineer\n\nRequired: 5+ years with React.", company_url: "https://acme.example/", days: 3 },
    ]);

    await evaluate(inputPath, outputPath, 2);

    const output = JSON.parse(await readFile(outputPath, "utf-8"));
    expect(output.kits).toHaveLength(2);

    const bad = output.kits.find((k: { id: string }) => k.id === "case-bad-url");
    expect(bad.status).toBe("failed");
    expect(bad.kit).toBeNull();
    expect(bad.error.code).toBe("COMPANY_UNREACHABLE");

    const good = output.kits.find((k: { id: string }) => k.id === "case-good");
    expect(good.status).toBe("ok");
    expect(good.kit).not.toBeNull();
  });

  it("records status 'ok' (not 'failed') when the company site is reachable but yields zero usable pages", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.includes("generativelanguage.googleapis.com")) {
          const body = JSON.parse((init!.body as string) ?? "{}");
          const sys: string = body.systemInstruction.parts[0].text;
          const prompt: string = body.contents[0].parts[0].text;
          if (sys.includes("extract job requirements")) {
            return geminiTextResponse({ requirements: [{ text: "5+ years with React", kind: "technical", priority: "must" }] });
          }
          if (sys.includes("interview questions for the")) {
            const idMatch = prompt.match(/\[r\d+\]/);
            const reqId = idMatch ? idMatch[0].slice(1, -1) : undefined;
            return geminiTextResponse({ questions: reqId ? [{ requirement_ids: [reqId], prompt: "q", answer_outline: "a", difficulty: 2 }] : [] });
          }
          return geminiTextResponse({ flashcards: [] });
        }
        // the company site is reachable but every page 404s, so this is a
        // real but fruitless research attempt, not a broken url
        return jsonResponse({}, false, 404);
      }),
    );

    const { inputPath, outputPath } = await writeInput([
      {
        id: "case-thin-research",
        jd: "Senior Backend Engineer\n\nRequired: 5+ years with React.",
        company_url: "https://deadsite.example/",
        days: 3,
      },
    ]);

    await evaluate(inputPath, outputPath, 1);

    const output = JSON.parse(await readFile(outputPath, "utf-8"));
    const result = output.kits[0];
    expect(result.status).toBe("ok");
    expect(result.error).toBeNull();
    expect(result.kit.source.pages_used).toEqual([]);
    expect(result.kit.company_brief.summary.toLowerCase()).toMatch(/did not find|unknown|limited/);
    expect(validateKit(result.kit).ok).toBe(true);
  });

  it("records a malformed case as INVALID_INPUT rather than crashing the whole run", async () => {
    stubGlobalFetch();
    const { inputPath, outputPath } = await writeInput([
      { id: "case-missing-jd", company_url: "https://acme.example/", days: 3 },
      { id: "case-good", jd: "Senior Backend Engineer\n\nRequired: 5+ years with React.", company_url: "https://acme.example/", days: 3 },
    ]);

    await evaluate(inputPath, outputPath, 2);

    const output = JSON.parse(await readFile(outputPath, "utf-8"));
    const bad = output.kits.find((k: { id: string }) => k.id === "case-missing-jd");
    expect(bad.status).toBe("failed");
    expect(bad.error.code).toBe("INVALID_INPUT");

    const good = output.kits.find((k: { id: string }) => k.id === "case-good");
    expect(good.status).toBe("ok");
  });

  it("throws a clear error for an unreadable input file rather than writing a bogus output", async () => {
    const outputPath = join(workDir, "kits.json");
    await expect(evaluate(join(workDir, "does-not-exist.json"), outputPath)).rejects.toThrow(/Could not read input file/);
  });

  it("throws a clear error when the input file isn't a JSON array", async () => {
    const inputPath = join(workDir, "cases.json");
    const outputPath = join(workDir, "kits.json");
    await writeFile(inputPath, JSON.stringify({ not: "an array" }), "utf-8");
    await expect(evaluate(inputPath, outputPath)).rejects.toThrow(/must contain a JSON array/);
  });
});
