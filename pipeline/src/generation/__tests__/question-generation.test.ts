import { describe, expect, it, vi } from "vitest";
import type { Requirement } from "../../schema/kit.js";
import {
  assignQuestionIds,
  generateQuestionBank,
  heuristicQuestionsForCategory,
} from "../question-generation.js";

function geminiResponse(payload: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }] }),
  } as unknown as Response;
}

const requirements: Requirement[] = [
  { id: "r1", text: "5+ years with React", kind: "technical", priority: "must" },
  { id: "r2", text: "Strong communication skills", kind: "behavioural", priority: "must" },
  { id: "r3", text: "Healthcare industry experience", kind: "domain", priority: "nice" },
];

describe("generateQuestionBank", () => {
  it("makes exactly four separate LLM calls, one per category, when a key is configured", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(geminiResponse({ questions: [] }));

    await generateQuestionBank({
      requirements,
      companyContext: "Acme builds widgets.",
      geminiConfig: { apiKey: "key", fetchImpl },
    });

    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it("routes only the category-relevant requirements into each call's prompt", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(geminiResponse({ questions: [] }));

    await generateQuestionBank({
      requirements,
      companyContext: "Acme builds widgets.",
      geminiConfig: { apiKey: "key", fetchImpl },
    });

    const prompts = fetchImpl.mock.calls.map((call) => {
      const body = JSON.parse((call[1] as RequestInit).body as string);
      return { system: body.systemInstruction.parts[0].text as string, prompt: body.contents[0].parts[0].text as string };
    });

    const technicalCall = prompts.find((p) => p.system.includes('"technical"'));
    const behaviouralCall = prompts.find((p) => p.system.includes('"behavioural"'));

    expect(technicalCall?.prompt).toContain("5+ years with React");
    expect(technicalCall?.prompt).not.toContain("Strong communication skills");
    expect(behaviouralCall?.prompt).toContain("Strong communication skills");
    expect(behaviouralCall?.prompt).not.toContain("5+ years with React");
  });

  it("shifts what's generated when hiring-process notes are present", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(geminiResponse({ questions: [] }));

    await generateQuestionBank({
      requirements,
      companyContext: "Acme builds widgets.",
      hiringProcessNotes: "Interview loop includes a take-home and a system design round.",
      geminiConfig: { apiKey: "key", fetchImpl },
    });

    const anyPromptHasNotes = fetchImpl.mock.calls.some((call) => {
      const body = JSON.parse((call[1] as RequestInit).body as string);
      return (body.contents[0].parts[0].text as string).includes("take-home and a system design round");
    });
    expect(anyPromptHasNotes).toBe(true);
  });

  it("falls back to heuristic questions per category when the LLM is unavailable", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 500 } as Response);

    const questions = await generateQuestionBank({
      requirements,
      companyContext: "Acme builds widgets.",
      geminiConfig: { apiKey: "key", fetchImpl, maxRetries: 0 },
    });

    const categories = new Set(questions.map((q) => q.category));
    expect(categories).toEqual(new Set(["technical", "behavioural", "system-design", "company-fit"]));
  });
});

describe("heuristicQuestionsForCategory", () => {
  it("returns one templated question per requirement, reusing the requirement's own text", () => {
    const technicalReqs = requirements.filter((r) => r.kind === "technical");
    const questions = heuristicQuestionsForCategory("technical", technicalReqs);
    expect(questions).toHaveLength(1);
    expect(questions[0]!.prompt).toContain("5+ years with React");
    expect(questions[0]!.requirement_ids).toEqual(["r1"]);
  });

  it("returns a single honest generic fallback question when there are no requirements for the category", () => {
    const questions = heuristicQuestionsForCategory("company-fit", []);
    expect(questions).toHaveLength(1);
    expect(questions[0]!.requirement_ids).toEqual([]);
  });
});

describe("assignQuestionIds", () => {
  it("assigns sequential ids starting from the given index and sets generated/pristine defaults", () => {
    const [q] = assignQuestionIds(
      [{ category: "technical", requirement_ids: [], prompt: "p", answer_outline: "a", difficulty: 1 }],
      5,
    );
    expect(q!.id).toBe("q5");
    expect(q!.origin).toBe("generated");
    expect(q!.status).toBe("pristine");
  });
});
