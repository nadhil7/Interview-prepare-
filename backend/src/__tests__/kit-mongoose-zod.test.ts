import { validateKit } from "@aipk/pipeline";
import mongoose from "mongoose";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Kit } from "../models/Kit.js";
import { clearTestDb, startTestDb, stopTestDb } from "./mongo-test-utils.js";

beforeAll(startTestDb);
afterEach(clearTestDb);
afterAll(stopTestDb);

function buildFullKitPayload(userId: mongoose.Types.ObjectId) {
  return {
    userId,
    requestHash: "abc123",
    job: { status: "ready" as const, progress: 100, error: null },
    source: {
      company: "Acme",
      company_url: "https://acme.example",
      role: "Senior Backend Engineer",
      location: "Remote",
      jd_chars: 120,
      researched_at: "2026-09-21T00:00:00.000Z",
      pages_used: ["https://acme.example/careers"],
    },
    company_brief: {
      summary: "Acme builds widgets.",
      what_they_do: "Widget manufacturing SaaS.",
      sources: ["https://acme.example/about"],
    },
    role: {
      title: "Senior Backend Engineer",
      seniority: "senior",
      responsibilities: ["Own the widget API"],
      requirements: [
        { id: "r1", text: "5+ years with Node.js", kind: "technical", priority: "must" },
        { id: "r2", text: "Nice to have: GraphQL", kind: "technical", priority: "nice" },
      ],
    },
    questions: [
      {
        id: "q1",
        requirement_ids: ["r1"],
        category: "technical",
        prompt: "Explain event loop internals.",
        answer_outline: "Cover microtasks vs macrotasks.",
        difficulty: 2,
        origin: "generated",
        status: "pristine",
      },
      {
        id: "q2",
        requirement_ids: ["r2"],
        category: "technical",
        prompt: "How would you version a GraphQL schema?",
        answer_outline: "Discuss additive changes and deprecation.",
        difficulty: 3,
        origin: "user",
        status: "edited",
      },
    ],
    flashcards: [
      {
        id: "f1",
        front: "What is a microtask?",
        back: "A queued callback that runs after the current task.",
        requirement_ids: ["r1"],
        origin: "generated",
        status: "pristine",
      },
    ],
    schedule: {
      days_available: 2,
      days: [
        { day: 1, focus: "Node internals", question_ids: ["q1"], minutes: 45 },
        { day: 2, focus: "GraphQL", question_ids: ["q2"], minutes: 30 },
      ],
    },
    coverage: { uncovered_requirement_ids: [], passes: 1 },
  };
}

describe("Kit Mongoose schema <-> Zod kitSchema agreement", () => {
  it("round-trips a saved Kit document through validateKit without shape drift", async () => {
    const userId = new mongoose.Types.ObjectId();
    const created = await Kit.create(buildFullKitPayload(userId));

    const fetched = await Kit.findById(created._id).lean();
    expect(fetched).not.toBeNull();

    const result = validateKit(fetched);

    if (!result.ok) {
      throw new Error(`Mongoose Kit document failed Zod validation:\n${result.errors.join("\n")}`);
    }

    expect(result.ok).toBe(true);
    expect(result.data.role.requirements).toHaveLength(2);
    expect(result.data.questions.map((q) => q.id)).toEqual(["q1", "q2"]);
    expect(result.data.questions[1]?.origin).toBe("user");
    expect(result.data.questions[1]?.status).toBe("edited");
  });
});
