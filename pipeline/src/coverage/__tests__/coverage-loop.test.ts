import { describe, expect, it, vi } from "vitest";
import type { Question, Requirement } from "../../schema/kit.js";
import { MAX_COVERAGE_PASSES, runCoverageLoop } from "../coverage-loop.js";

function geminiResponse(payload: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }] }),
  } as unknown as Response;
}

const requirements: Requirement[] = [
  { id: "r1", text: "React", kind: "technical", priority: "must" },
  { id: "r2", text: "Communication", kind: "behavioural", priority: "must" },
];

function question(id: string, requirement_ids: string[]): Question {
  return {
    id,
    requirement_ids,
    category: "technical",
    prompt: "p",
    answer_outline: "a",
    difficulty: 1,
    origin: "generated",
    status: "pristine",
  };
}

describe("runCoverageLoop", () => {
  it("stops after pass 1 (no extra LLM calls) when everything is already covered", async () => {
    const fetchImpl = vi.fn();
    const result = await runCoverageLoop({
      requirements,
      initialQuestions: [question("q1", ["r1"]), question("q2", ["r2"])],
      companyContext: "Acme",
      geminiConfig: { apiKey: "key", fetchImpl },
    });

    expect(result.passes).toBe(1);
    expect(result.uncoveredRequirementIds).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("runs one gap-fill pass, scoped only to the uncovered requirement, and merges the new question in", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      geminiResponse({
        questions: [{ requirement_ids: ["r2"], prompt: "Tell me about communication", answer_outline: "a", difficulty: 1 }],
      }),
    );

    const result = await runCoverageLoop({
      requirements,
      initialQuestions: [question("q1", ["r1"])], // r2 uncovered
      companyContext: "Acme",
      geminiConfig: { apiKey: "key", fetchImpl },
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1); // only the behavioural category, not all 4
    expect(result.passes).toBe(2);
    expect(result.uncoveredRequirementIds).toEqual([]);
    expect(result.questions.map((q) => q.id)).toEqual(["q1", "q2"]); // no id collision
    expect(result.questions[1]!.requirement_ids).toEqual(["r2"]);
  });

  it("still fully resolves coverage within the pass cap when Gemini is completely unavailable, via the heuristic fallback", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 500 } as Response);

    const result = await runCoverageLoop({
      requirements,
      initialQuestions: [],
      companyContext: "Acme",
      geminiConfig: { apiKey: "key", fetchImpl, maxRetries: 0 },
    });

    // one gap-fill pass on top of the (empty) initial pass = MAX_COVERAGE_PASSES
    expect(result.passes).toBe(MAX_COVERAGE_PASSES);
    expect(result.uncoveredRequirementIds).toEqual([]);
    expect(result.questions).toHaveLength(2);
  });

  it("never exceeds MAX_COVERAGE_PASSES total", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 500 } as Response);
    const result = await runCoverageLoop({
      requirements,
      initialQuestions: [],
      companyContext: "Acme",
      geminiConfig: { apiKey: "key", fetchImpl, maxRetries: 0 },
    });
    expect(result.passes).toBeLessThanOrEqual(MAX_COVERAGE_PASSES);
  });
});
