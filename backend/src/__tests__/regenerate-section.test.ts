import mongoose from "mongoose";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Kit } from "../models/Kit.js";
import { AppError } from "../orchestration/errors.js";
import { isRegenerableSection, regenerateSection } from "../orchestration/regenerate-section.js";
import { clearTestDb, startTestDb, stopTestDb } from "./mongo-test-utils.js";

beforeAll(startTestDb);
afterEach(clearTestDb);
afterAll(stopTestDb);

function geminiResponse(payload: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }] }),
  } as unknown as Response;
}

async function seedReadyKit(userId: mongoose.Types.ObjectId) {
  return Kit.create({
    userId,
    requestHash: "hash",
    job: { status: "ready", progress: 100, error: null },
    source: { company: "Acme", company_url: "https://acme.example", role: "Engineer", location: "", jd_chars: 100, researched_at: "now", pages_used: [] },
    research: { pages: [{ url: "https://acme.example", text: "Acme builds widgets." }], hiringProcessNotes: "" },
    company_brief: { summary: "Acme builds widgets.", what_they_do: "Widgets.", sources: ["https://acme.example"] },
    role: {
      title: "Engineer",
      seniority: "senior",
      responsibilities: [],
      requirements: [
        { id: "r1", text: "5+ years with React", kind: "technical", priority: "must" },
        { id: "r2", text: "Strong communication", kind: "behavioural", priority: "must" },
      ],
    },
    questions: [
      { id: "q1", requirement_ids: ["r1"], category: "technical", prompt: "old pristine technical Q", answer_outline: "a", difficulty: 2, origin: "generated", status: "pristine" },
      { id: "q2", requirement_ids: ["r1"], category: "technical", prompt: "user-edited technical Q", answer_outline: "a", difficulty: 2, origin: "user", status: "edited" },
      { id: "q3", requirement_ids: ["r1"], category: "technical", prompt: "pinned technical Q", answer_outline: "a", difficulty: 1, origin: "generated", status: "pinned" },
      { id: "q4", requirement_ids: ["r2"], category: "behavioural", prompt: "behavioural Q, untouched category", answer_outline: "a", difficulty: 1, origin: "generated", status: "pristine" },
    ],
    flashcards: [],
    schedule: {
      days_available: 2,
      days: [
        { day: 1, focus: "Technical", question_ids: ["q1", "q2"], minutes: 55 },
        { day: 2, focus: "Behavioural, Technical", question_ids: ["q3", "q4"], minutes: 40 },
      ],
    },
    coverage: { uncovered_requirement_ids: [], passes: 1 },
  });
}

describe("regenerateSection — question category", () => {
  it("replaces only pristine items in the category, leaving edited/pinned items and other categories untouched", async () => {
    const userId = new mongoose.Types.ObjectId();
    const kit = await seedReadyKit(userId);

    const fetchImpl = fakeGeminiFetch({
      questions: [{ requirement_ids: ["r1"], prompt: "freshly regenerated technical Q", answer_outline: "a", difficulty: 3 }],
    });

    const updated = await regenerateSection(kit.id, userId.toString(), "technical", { apiKey: "key", fetchImpl });

    const byId = new Map(updated.questions.map((q) => [q.id, q]));

    // pristine q1 was replaced (gone)
    expect(byId.has("q1")).toBe(false);
    // edited and pinned survive completely unchanged
    expect(byId.get("q2")).toMatchObject({ prompt: "user-edited technical Q", status: "edited" });
    expect(byId.get("q3")).toMatchObject({ prompt: "pinned technical Q", status: "pinned" });
    // other category untouched
    expect(byId.get("q4")).toMatchObject({ prompt: "behavioural Q, untouched category", status: "pristine" });
    // a freshly generated technical question was added, with a non-colliding id
    const fresh = updated.questions.find((q) => q.prompt === "freshly regenerated technical Q");
    expect(fresh).toBeDefined();
    expect(byId.has(fresh!.id)).toBe(true);
    expect(["q1", "q2", "q3", "q4"]).not.toContain(fresh!.id);
  });

  it("recomputes coverage and schedule against the merged question set", async () => {
    const userId = new mongoose.Types.ObjectId();
    const kit = await seedReadyKit(userId);
    const fetchImpl = fakeGeminiFetch({
      questions: [{ requirement_ids: ["r1"], prompt: "new Q", answer_outline: "a", difficulty: 2 }],
    });

    const updated = await regenerateSection(kit.id, userId.toString(), "technical", { apiKey: "key", fetchImpl });

    expect(updated.coverage.uncovered_requirement_ids).toEqual([]);
    const scheduledIds = new Set(updated.schedule.days.flatMap((d) => d.question_ids));
    for (const q of updated.questions) {
      expect(scheduledIds.has(q.id)).toBe(true);
    }
  });

  it("refuses to regenerate a kit that isn't ready yet", async () => {
    const userId = new mongoose.Types.ObjectId();
    const kit = await seedReadyKit(userId);
    await Kit.findByIdAndUpdate(kit.id, { "job.status": "generating" });

    await expect(regenerateSection(kit.id, userId.toString(), "technical", { apiKey: "key" })).rejects.toThrow(AppError);
  });

  it("refuses to regenerate a kit belonging to a different user", async () => {
    const userId = new mongoose.Types.ObjectId();
    const kit = await seedReadyKit(userId);
    const otherUserId = new mongoose.Types.ObjectId().toString();

    await expect(regenerateSection(kit.id, otherUserId, "technical", { apiKey: "key" })).rejects.toThrow(AppError);
  });
});

describe("regenerateSection — company_brief", () => {
  it("replaces the whole brief and leaves questions untouched", async () => {
    const userId = new mongoose.Types.ObjectId();
    const kit = await seedReadyKit(userId);
    const fetchImpl = fakeGeminiFetch({ summary: "Updated summary.", what_they_do: "Updated description." });

    const updated = await regenerateSection(kit.id, userId.toString(), "company_brief", { apiKey: "key", fetchImpl });

    expect(updated.company_brief.summary).toBe("Updated summary.");
    expect(updated.questions).toHaveLength(4);
  });
});

describe("isRegenerableSection", () => {
  it("accepts the known sections", () => {
    for (const s of ["company_brief", "schedule", "technical", "behavioural", "system-design", "company-fit"]) {
      expect(isRegenerableSection(s)).toBe(true);
    }
  });

  it("rejects anything else", () => {
    expect(isRegenerableSection("flashcards")).toBe(false);
    expect(isRegenerableSection("nonsense")).toBe(false);
  });
});

function fakeGeminiFetch(payload: unknown): typeof fetch {
  return (async () => geminiResponse(payload)) as typeof fetch;
}
