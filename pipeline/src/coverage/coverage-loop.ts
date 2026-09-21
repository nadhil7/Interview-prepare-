import type { GeminiClientConfig } from "../generation/gemini-client.js";
import {
  assignQuestionIds,
  generateQuestionsForCategory,
  type QuestionCategory,
} from "../generation/question-generation.js";
import type { Question, Requirement } from "../schema/kit.js";
import { findUncoveredRequirementIds } from "./coverage-checker.js";

/**
 * capped at 2 total passes, one initial pass plus one pass to fill gaps.
 * in practice a single extra pass fixes nearly every coverage miss, and
 * each extra pass after that costs a full round of gemini calls against
 * the free tier budget for very little gain. coverage.passes in the
 * finished kit records how many actually ran.
 */
export const MAX_COVERAGE_PASSES = 2;

const KIND_TO_CATEGORY: Record<Requirement["kind"], QuestionCategory> = {
  technical: "technical",
  behavioural: "behavioural",
  domain: "company-fit",
};

function groupGapRequirementsByCategory(requirements: Requirement[]): Map<QuestionCategory, Requirement[]> {
  const grouped = new Map<QuestionCategory, Requirement[]>();
  for (const req of requirements) {
    const category = KIND_TO_CATEGORY[req.kind];
    const existing = grouped.get(category);
    if (existing) existing.push(req);
    else grouped.set(category, [req]);
  }
  return grouped;
}

export interface RunCoverageLoopOptions {
  requirements: Requirement[];
  initialQuestions: Question[];
  companyContext: string;
  hiringProcessNotes?: string;
  geminiConfig: GeminiClientConfig;
}

export interface CoverageLoopResult {
  questions: Question[];
  uncoveredRequirementIds: string[];
  passes: number;
}

/**
 * runs the coverage checker. if requirements are still uncovered after
 * the first generation pass, it runs question generation again but only
 * for those requirements, grouped by category so it is still one call per
 * category and never everything at once, merges the new questions in, and
 * checks again. stops as soon as nothing is uncovered, or once the pass
 * limit is reached.
 */
export async function runCoverageLoop(options: RunCoverageLoopOptions): Promise<CoverageLoopResult> {
  let questions = options.initialQuestions;
  let passes = 1;
  let uncoveredIds = findUncoveredRequirementIds(options.requirements, questions);

  while (uncoveredIds.length > 0 && passes < MAX_COVERAGE_PASSES) {
    const gapRequirements = options.requirements.filter((r) => uncoveredIds.includes(r.id));
    const byCategory = groupGapRequirementsByCategory(gapRequirements);

    const generatedBatches = await Promise.all(
      Array.from(byCategory.entries()).map(([category, requirements]) =>
        generateQuestionsForCategory({
          category,
          requirements,
          companyContext: options.companyContext,
          hiringProcessNotes: options.hiringProcessNotes,
          geminiConfig: options.geminiConfig,
          count: requirements.length,
        }),
      ),
    );

    const nextIndexStart = questions.length + 1;
    const newQuestions = assignQuestionIds(generatedBatches.flat(), nextIndexStart);
    questions = [...questions, ...newQuestions];
    passes++;
    uncoveredIds = findUncoveredRequirementIds(options.requirements, questions);
  }

  return { questions, uncoveredRequirementIds: uncoveredIds, passes };
}
