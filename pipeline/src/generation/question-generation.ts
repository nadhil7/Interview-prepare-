import { z } from "zod";
import { questionCategorySchema, type Question, type Requirement } from "../schema/kit.js";
import { generateJson, GeminiUnavailableError, type GeminiClientConfig } from "./gemini-client.js";
import { UNTRUSTED_DATA_WARNING, wrapUntrustedContent } from "./prompt-safety.js";

export type QuestionCategory = z.infer<typeof questionCategorySchema>;
export type GeneratedQuestion = Omit<Question, "id" | "origin" | "status">;

const generatedQuestionSchema = z.object({
  requirement_ids: z.array(z.string()),
  prompt: z.string().min(1),
  answer_outline: z.string(),
  difficulty: z.number().int().min(1).max(3),
});
const questionsResponseSchema = z.object({ questions: z.array(generatedQuestionSchema) });

const GEMINI_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    questions: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          requirement_ids: { type: "ARRAY", items: { type: "STRING" } },
          prompt: { type: "STRING" },
          answer_outline: { type: "STRING" },
          difficulty: { type: "INTEGER" },
        },
        required: ["requirement_ids", "prompt", "answer_outline", "difficulty"],
      },
    },
  },
  required: ["questions"],
};

const CATEGORY_GUIDANCE: Record<QuestionCategory, string> = {
  technical: "Write technical interview questions testing the specific skills/tools/languages named in the given requirements.",
  behavioural: "Write behavioural interview questions (e.g. STAR-style) probing the soft-skill requirements given.",
  "system-design":
    "Write system-design interview questions appropriate to the seniority and technical requirements given. If the hiring-process notes mention a specific format (e.g. a take-home vs. a live whiteboard round), shape the questions to match that format.",
  "company-fit":
    "Write company-fit / culture interview questions connecting the candidate's motivations to what this specific company does, based on the company context given.",
};

function buildSystemInstruction(category: QuestionCategory): string {
  return `You write interview questions for the "${category}" category.
${CATEGORY_GUIDANCE[category]}
Rules:
- Base every question on the requirements, company context, and hiring-process notes given below — do not invent unrelated content.
- Each question lists the requirement_ids (from the given requirements) it targets. A general category question not tied to one requirement (e.g. a generic company-fit question) uses an empty requirement_ids array.
- difficulty is an integer from 1 (easy) to 3 (hard).
${UNTRUSTED_DATA_WARNING}
Respond only with JSON matching the schema.`;
}

export interface GenerateQuestionsForCategoryOptions {
  category: QuestionCategory;
  requirements: Requirement[];
  companyContext: string;
  hiringProcessNotes?: string;
  geminiConfig: GeminiClientConfig;
  count?: number;
}

export async function generateQuestionsForCategory(
  options: GenerateQuestionsForCategoryOptions,
): Promise<GeneratedQuestion[]> {
  const count = options.count ?? 3;
  const requirementsText =
    options.requirements.length > 0
      ? options.requirements.map((r) => `- [${r.id}] (${r.kind}, ${r.priority}) ${r.text}`).join("\n")
      : "(no specific requirements were extracted for this category)";

  const prompt = `Write about ${count} questions.\n\n${wrapUntrustedContent([
    { label: "relevant_requirements", content: requirementsText },
    { label: "company_context", content: options.companyContext || "(no company research available)" },
    { label: "hiring_process_notes", content: options.hiringProcessNotes || "(no public hiring-process information found)" },
  ])}`;

  try {
    const result = await generateJson(
      options.geminiConfig,
      { systemInstruction: buildSystemInstruction(options.category), prompt, responseSchema: GEMINI_RESPONSE_SCHEMA },
      (raw) => questionsResponseSchema.parse(raw),
    );
    return result.questions.map((q) => ({ ...q, category: options.category }));
  } catch (err) {
    if (err instanceof GeminiUnavailableError) {
      return heuristicQuestionsForCategory(options.category, options.requirements);
    }
    throw err;
  }
}

/** Deterministic fallback: templated questions built from requirement text actually present in the JD. */
export function heuristicQuestionsForCategory(
  category: QuestionCategory,
  requirements: Requirement[],
): GeneratedQuestion[] {
  if (requirements.length === 0) {
    return [
      {
        category,
        requirement_ids: [],
        prompt: `Generic ${category.replace("-", " ")} interview question (no specific requirements were available to target).`,
        answer_outline: "No research or job-description signal was available to ground this question.",
        difficulty: 1,
      },
    ];
  }

  return requirements.map((req) => ({
    category,
    requirement_ids: [req.id],
    prompt: `Discuss the requirement: "${req.text}"`,
    answer_outline: `Cover your direct, concrete experience with: ${req.text}`,
    difficulty: req.priority === "must" ? 2 : 1,
  }));
}

export interface GenerateQuestionBankOptions {
  requirements: Requirement[];
  companyContext: string;
  hiringProcessNotes?: string;
  geminiConfig: GeminiClientConfig;
}

/**
 * Four separate LLM calls, one per category — never one call asked to
 * produce everything. Each call only sees the requirements relevant to its
 * category, so what gets generated visibly shifts with what was actually
 * extracted/researched (e.g. no behavioural requirements -> a generic
 * behavioural fallback question, not padded technical content).
 */
export async function generateQuestionBank(options: GenerateQuestionBankOptions): Promise<GeneratedQuestion[]> {
  const technicalReqs = options.requirements.filter((r) => r.kind === "technical");
  const behaviouralReqs = options.requirements.filter((r) => r.kind === "behavioural");
  const domainReqs = options.requirements.filter((r) => r.kind === "domain");

  const shared = {
    companyContext: options.companyContext,
    hiringProcessNotes: options.hiringProcessNotes,
    geminiConfig: options.geminiConfig,
  };

  const [technical, behavioural, systemDesign, companyFit] = await Promise.all([
    generateQuestionsForCategory({ category: "technical", requirements: technicalReqs, ...shared }),
    generateQuestionsForCategory({ category: "behavioural", requirements: behaviouralReqs, ...shared }),
    generateQuestionsForCategory({ category: "system-design", requirements: technicalReqs, ...shared }),
    generateQuestionsForCategory({ category: "company-fit", requirements: domainReqs, ...shared }),
  ]);

  return [...technical, ...behavioural, ...systemDesign, ...companyFit];
}

export function assignQuestionIds(questions: GeneratedQuestion[], startIndex = 1): Question[] {
  return questions.map((q, i) => ({ ...q, id: `q${startIndex + i}`, origin: "generated", status: "pristine" }));
}
