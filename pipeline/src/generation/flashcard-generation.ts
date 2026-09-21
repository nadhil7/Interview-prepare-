import { z } from "zod";
import type { Flashcard, Question, Requirement } from "../schema/kit.js";
import { generateJson, GeminiUnavailableError, type GeminiClientConfig } from "./gemini-client.js";
import { UNTRUSTED_DATA_WARNING, wrapUntrustedContent } from "./prompt-safety.js";

export type GeneratedFlashcard = Omit<Flashcard, "id" | "origin" | "status">;

const generatedFlashcardSchema = z.object({
  front: z.string().min(1),
  back: z.string().min(1),
  requirement_ids: z.array(z.string()),
});
const flashcardsResponseSchema = z.object({ flashcards: z.array(generatedFlashcardSchema) });

const GEMINI_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    flashcards: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          front: { type: "STRING" },
          back: { type: "STRING" },
          requirement_ids: { type: "ARRAY", items: { type: "STRING" } },
        },
        required: ["front", "back", "requirement_ids"],
      },
    },
  },
  required: ["flashcards"],
};

const SYSTEM_INSTRUCTION = `You write flashcards (front/back) to help someone drill interview prep material.
Base flashcards on the requirements and questions given below — do not invent unrelated facts.
Keep the front short (a prompt or term) and the back concise (the key point to recall).
${UNTRUSTED_DATA_WARNING}
Respond only with JSON matching the schema.`;

export interface GenerateFlashcardsOptions {
  requirements: Requirement[];
  questions: Question[];
  geminiConfig: GeminiClientConfig;
}

export async function generateFlashcards(options: GenerateFlashcardsOptions): Promise<GeneratedFlashcard[]> {
  if (options.requirements.length === 0 && options.questions.length === 0) return [];

  const requirementsText = options.requirements.map((r) => `- [${r.id}] ${r.text}`).join("\n") || "(none)";
  const questionsText =
    options.questions.map((q) => `- [${q.id}] (${q.category}) ${q.prompt} — ${q.answer_outline}`).join("\n") ||
    "(none)";

  const prompt = `Write flashcards covering the material below.\n\n${wrapUntrustedContent([
    { label: "requirements", content: requirementsText },
    { label: "questions", content: questionsText },
  ])}`;

  try {
    const result = await generateJson(
      options.geminiConfig,
      { systemInstruction: SYSTEM_INSTRUCTION, prompt, responseSchema: GEMINI_RESPONSE_SCHEMA },
      (raw) => flashcardsResponseSchema.parse(raw),
    );
    return result.flashcards;
  } catch (err) {
    if (err instanceof GeminiUnavailableError) {
      return heuristicFlashcards(options.questions);
    }
    throw err;
  }
}

/** Deterministic fallback: turns each already-generated question directly into a flashcard. */
export function heuristicFlashcards(questions: Question[]): GeneratedFlashcard[] {
  return questions.map((q) => ({
    front: q.prompt,
    back: q.answer_outline || "No answer outline available.",
    requirement_ids: q.requirement_ids,
  }));
}

export function assignFlashcardIds(flashcards: GeneratedFlashcard[], startIndex = 1): Flashcard[] {
  return flashcards.map((f, i) => ({ ...f, id: `f${startIndex + i}`, origin: "generated", status: "pristine" }));
}
