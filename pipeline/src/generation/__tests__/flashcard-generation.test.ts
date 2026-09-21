import { describe, expect, it, vi } from "vitest";
import type { Question, Requirement } from "../../schema/kit.js";
import { assignFlashcardIds, generateFlashcards, heuristicFlashcards } from "../flashcard-generation.js";

function geminiResponse(payload: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }] }),
  } as unknown as Response;
}

const requirements: Requirement[] = [{ id: "r1", text: "5+ years with React", kind: "technical", priority: "must" }];
const questions: Question[] = [
  {
    id: "q1",
    requirement_ids: ["r1"],
    category: "technical",
    prompt: "Explain React's reconciliation algorithm.",
    answer_outline: "Cover the virtual DOM diffing process.",
    difficulty: 2,
    origin: "generated",
    status: "pristine",
  },
];

describe("generateFlashcards", () => {
  it("returns an empty array when there is nothing to base flashcards on", async () => {
    const fetchImpl = vi.fn();
    const cards = await generateFlashcards({ requirements: [], questions: [], geminiConfig: { apiKey: "key", fetchImpl } });
    expect(cards).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("uses the LLM result when the call succeeds", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      geminiResponse({ flashcards: [{ front: "What is reconciliation?", back: "Virtual DOM diffing.", requirement_ids: ["r1"] }] }),
    );

    const cards = await generateFlashcards({ requirements, questions, geminiConfig: { apiKey: "key", fetchImpl } });
    expect(cards).toHaveLength(1);
    expect(cards[0]!.front).toBe("What is reconciliation?");
  });

  it("falls back to turning existing questions into flashcards when the LLM is unavailable", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 500 } as Response);

    const cards = await generateFlashcards({
      requirements,
      questions,
      geminiConfig: { apiKey: "key", fetchImpl, maxRetries: 0 },
    });

    expect(cards).toEqual([
      { front: "Explain React's reconciliation algorithm.", back: "Cover the virtual DOM diffing process.", requirement_ids: ["r1"] },
    ]);
  });
});

describe("heuristicFlashcards", () => {
  it("reuses the question's prompt and answer outline verbatim", () => {
    const [card] = heuristicFlashcards(questions);
    expect(card!.front).toBe(questions[0]!.prompt);
    expect(card!.back).toBe(questions[0]!.answer_outline);
  });
});

describe("assignFlashcardIds", () => {
  it("assigns sequential ids and generated/pristine defaults", () => {
    const [card] = assignFlashcardIds([{ front: "f", back: "b", requirement_ids: [] }], 3);
    expect(card!.id).toBe("f3");
    expect(card!.origin).toBe("generated");
    expect(card!.status).toBe("pristine");
  });
});
