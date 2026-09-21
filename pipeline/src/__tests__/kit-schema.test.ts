import { describe, expect, it } from "vitest";
import { validateKit } from "../schema/kit.js";

function buildMinimalValidKit() {
  return {
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
      },
    ],
    flashcards: [
      { id: "f1", front: "What is a microtask?", back: "A queued callback...", requirement_ids: ["r1"] },
    ],
    schedule: {
      days_available: 1,
      days: [{ day: 1, focus: "Node internals", question_ids: ["q1"], minutes: 45 }],
    },
    coverage: { uncovered_requirement_ids: [], passes: 1 },
  };
}

describe("validateKit", () => {
  it("accepts a minimal well-formed kit and fills additive defaults", () => {
    const result = validateKit(buildMinimalValidKit());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.questions[0]?.origin).toBe("generated");
      expect(result.data.questions[0]?.status).toBe("pristine");
    }
  });

  it("rejects a kit with a non-integer difficulty", () => {
    const kit = buildMinimalValidKit();
    kit.questions[0]!.difficulty = 2.5 as unknown as number;
    const result = validateKit(kit);
    expect(result.ok).toBe(false);
  });

  it("rejects a schedule day referencing a question id that doesn't exist", () => {
    const kit = buildMinimalValidKit();
    kit.schedule.days[0]!.question_ids = ["does-not-exist"];
    const result = validateKit(kit);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("unknown question_id"))).toBe(true);
    }
  });

  it("rejects a must-priority requirement with no referencing question", () => {
    const kit = buildMinimalValidKit();
    kit.role.requirements.push({ id: "r2", text: "Must know Kubernetes", kind: "technical", priority: "must" });
    const result = validateKit(kit);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('requirement "r2" has no referencing question'))).toBe(true);
    }
  });

  it("rejects a kit missing required top-level sections", () => {
    const result = validateKit({ source: {} });
    expect(result.ok).toBe(false);
  });
});
