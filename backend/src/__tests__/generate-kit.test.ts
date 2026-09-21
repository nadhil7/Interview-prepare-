import { validateKit } from "@aipk/pipeline";
import mongoose from "mongoose";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Kit } from "../models/Kit.js";
import { computeRequestHash, findOrCreateKitJob, runGenerationJob, sweepStaleJobs } from "../orchestration/generate-kit.js";
import { clearTestDb, startTestDb, stopTestDb } from "./mongo-test-utils.js";

beforeAll(startTestDb);
afterEach(() => {
  vi.unstubAllGlobals();
  return clearTestDb();
});
afterAll(stopTestDb);

const BASE_INPUT = { jd: "Senior Backend Engineer\n\nRequired: 5+ years with React.", companyUrl: "https://acme.example/", days: 3 };

describe("findOrCreateKitJob — duplicate-submission handling", () => {
  it("creates a new kit on first submission", async () => {
    const { kit, isNew } = await findOrCreateKitJob(new mongoose.Types.ObjectId().toString(), BASE_INPUT);
    expect(isNew).toBe(true);
    expect(kit.job.status).toBe("pending");
  });

  it("returns the existing kit on a second identical submission instead of creating another", async () => {
    const userId = new mongoose.Types.ObjectId().toString();
    const first = await findOrCreateKitJob(userId, BASE_INPUT);
    const second = await findOrCreateKitJob(userId, BASE_INPUT);

    expect(second.isNew).toBe(false);
    expect(second.kit.id).toBe(first.kit.id);

    const count = await Kit.countDocuments({ userId, requestHash: computeRequestHash(BASE_INPUT) });
    expect(count).toBe(1);
  });

  it("treats a different user submitting the same jd/url/days as a separate kit", async () => {
    const first = await findOrCreateKitJob(new mongoose.Types.ObjectId().toString(), BASE_INPUT);
    const second = await findOrCreateKitJob(new mongoose.Types.ObjectId().toString(), BASE_INPUT);
    expect(first.kit.id).not.toBe(second.kit.id);
  });

  it("resets and restarts a stuck job on resubmission instead of returning it inert forever", async () => {
    const userId = new mongoose.Types.ObjectId().toString();
    const { kit } = await findOrCreateKitJob(userId, BASE_INPUT);

    // simulate a crash mid run, stuck in researching, last touched long ago.
    // this writes through the raw driver to skip mongoose's automatic
    // timestamps, since save or findOneAndUpdate would refresh updatedAt to now
    await Kit.collection.updateOne(
      { _id: kit._id },
      { $set: { "job.status": "researching", updatedAt: new Date(Date.now() - 10 * 60 * 1000) } },
    );

    const result = await findOrCreateKitJob(userId, BASE_INPUT);
    expect(result.isNew).toBe(true);
    expect(result.kit.id).toBe(kit.id);
    expect(result.kit.job.status).toBe("pending");
  });

  it("does not disturb a job that's merely slow but still recent", async () => {
    const userId = new mongoose.Types.ObjectId().toString();
    const { kit } = await findOrCreateKitJob(userId, BASE_INPUT);
    await Kit.findByIdAndUpdate(kit.id, { "job.status": "generating" });

    const result = await findOrCreateKitJob(userId, BASE_INPUT);
    expect(result.isNew).toBe(false);
    expect(result.kit.job.status).toBe("generating");
  });
});

describe("sweepStaleJobs", () => {
  it("marks a stuck non-terminal job as failed with STALE_JOB once past the timeout", async () => {
    const { kit } = await findOrCreateKitJob(new mongoose.Types.ObjectId().toString(), BASE_INPUT);
    await Kit.collection.updateOne(
      { _id: kit._id },
      { $set: { "job.status": "generating", updatedAt: new Date(Date.now() - 10 * 60 * 1000) } },
    );

    const swept = await sweepStaleJobs(5 * 60 * 1000);
    expect(swept).toBe(1);

    const updated = await Kit.findById(kit.id).lean();
    expect(updated!.job.status).toBe("failed");
    expect((updated!.job.error as { code: string }).code).toBe("STALE_JOB");
  });

  it("leaves a recent non-terminal job alone", async () => {
    const { kit } = await findOrCreateKitJob(new mongoose.Types.ObjectId().toString(), BASE_INPUT);
    await Kit.findByIdAndUpdate(kit.id, { "job.status": "generating" });

    const swept = await sweepStaleJobs(5 * 60 * 1000);
    expect(swept).toBe(0);

    const updated = await Kit.findById(kit.id).lean();
    expect(updated!.job.status).toBe("generating");
  });

  it("never touches a terminal (ready/failed) job", async () => {
    const { kit } = await findOrCreateKitJob(new mongoose.Types.ObjectId().toString(), BASE_INPUT);
    await Kit.collection.updateOne(
      { _id: kit._id },
      { $set: { "job.status": "ready", updatedAt: new Date(Date.now() - 60 * 60 * 1000) } },
    );

    const swept = await sweepStaleJobs(5 * 60 * 1000);
    expect(swept).toBe(0);
  });
});

describe("runGenerationJob — failure path", () => {
  it("lands the job in status 'failed' with a structured COMPANY_UNREACHABLE error when the URL is blocked, instead of throwing", async () => {
    const { kit } = await findOrCreateKitJob(new mongoose.Types.ObjectId().toString(), {
      ...BASE_INPUT,
      companyUrl: "http://127.0.0.1/internal",
    });

    await runGenerationJob(
      kit.id,
      { ...BASE_INPUT, companyUrl: "http://127.0.0.1/internal" },
      { apiKey: "key" },
      { blockPrivateNetworks: true },
    );

    const updated = await Kit.findById(kit.id).lean();
    expect(updated!.job.status).toBe("failed");
    expect((updated!.job.error as { code: string }).code).toBe("COMPANY_UNREACHABLE");
  });
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

/**
 * one global fetch stub handles the crawler and search calls with real
 * html, and the gemini calls by reading the system instruction text, so
 * the whole run can happen fully offline.
 */
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

describe("runGenerationJob — happy path", () => {
  it("runs the full pipeline end-to-end and lands on a valid, ready kit", async () => {
    stubGlobalFetch();

    const { kit } = await findOrCreateKitJob(new mongoose.Types.ObjectId().toString(), BASE_INPUT);
    await runGenerationJob(kit.id, BASE_INPUT, { apiKey: "key" }, { blockPrivateNetworks: false });

    const updated = await Kit.findById(kit.id).lean();
    expect(updated!.job.status).toBe("ready");
    expect(updated!.job.error).toBeNull();

    const validation = validateKit(updated);
    expect(validation.ok).toBe(true);

    expect(updated!.role.requirements.length).toBeGreaterThan(0);
    expect(updated!.schedule.days).toHaveLength(BASE_INPUT.days);
    expect(updated!.company_brief.summary).toBe("Acme builds widgets.");
    expect(updated!.source.pages_used.length).toBeGreaterThan(0);
  });
});
