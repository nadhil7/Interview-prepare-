import {
  allocateSchedule,
  assignQuestionIds,
  findUncoveredRequirementIds,
  generateCompanyBrief,
  generateQuestionsForCategory,
  getCategoryRequirements,
  validateKit,
  type Kit as KitContract,
  type GeminiClientConfig,
  type QuestionCategory,
} from "@aipk/pipeline";
import { Kit } from "../models/Kit.js";
import { AppError } from "./errors.js";
import { nextIndexFor } from "./ids.js";

const QUESTION_CATEGORIES: QuestionCategory[] = ["technical", "behavioural", "system-design", "company-fit"];

export type RegenerableSection = "company_brief" | "schedule" | QuestionCategory;

export function isRegenerableSection(value: string): value is RegenerableSection {
  return value === "company_brief" || value === "schedule" || QUESTION_CATEGORIES.includes(value as QuestionCategory);
}

interface KitLean extends KitContract {
  _id: unknown;
  job: { status: string; progress: number; error: unknown };
  research?: { pages: { url: string; text: string }[]; hiringProcessNotes?: string };
}

/**
 * Regenerates exactly one section. For a question category, only
 * origin:"generated"/status:"pristine" items in that category are
 * replaced — anything the user edited or pinned is left untouched — and
 * coverage is rechecked against the merged result afterward. company_brief
 * isn't itemized with origin/status (it's a single object, not a list of
 * user-editable atoms the way questions/flashcards are), so regenerating it
 * replaces the whole section.
 *
 * Schedule is unconditionally recomputed after every regen (not just an
 * explicit "schedule" request): a category regen can drop a pristine
 * question the old schedule pointed at (dangling question_ids) or add a
 * new one covering a must-requirement that isn't scheduled yet. Recomputing
 * keeps the kit passing validateKit's cross-field checks after any regen;
 * for a brief-only regen this reproduces the same layout, so it's a no-op
 * in that case.
 */
export async function regenerateSection(
  kitId: string,
  userId: string,
  section: RegenerableSection,
  geminiConfig: GeminiClientConfig,
): Promise<KitLean> {
  const doc = await Kit.findOne({ _id: kitId, userId }).lean();
  if (!doc) throw new AppError("NOT_FOUND", "kit not found");
  const kit = doc as unknown as KitLean;

  if (kit.job.status !== "ready") {
    throw new AppError("KIT_NOT_READY", `kit is not ready for regeneration (current status: ${kit.job.status})`);
  }

  const requirements = kit.role.requirements;
  const companyContext = `${kit.company_brief.summary}\n${kit.company_brief.what_they_do}`;

  let companyBrief = kit.company_brief;
  let questions = kit.questions;

  if (section === "company_brief") {
    companyBrief = await generateCompanyBrief(kit.source.company, kit.research?.pages ?? [], geminiConfig);
  } else if (section !== "schedule") {
    const category = section;
    const preserved = questions.filter((q) => q.category === category && (q.status === "edited" || q.status === "pinned"));
    const otherCategories = questions.filter((q) => q.category !== category);

    const relevantRequirements = getCategoryRequirements(category, requirements);
    const nextIndex = nextIndexFor(questions.map((q) => q.id), "q");
    const freshlyGenerated = assignQuestionIds(
      await generateQuestionsForCategory({
        category,
        requirements: relevantRequirements,
        companyContext,
        hiringProcessNotes: kit.research?.hiringProcessNotes,
        geminiConfig,
      }),
      nextIndex,
    );

    questions = [...otherCategories, ...preserved, ...freshlyGenerated];
  }

  const schedule = allocateSchedule(questions, requirements, kit.schedule.days_available);
  const coverage = { uncovered_requirement_ids: findUncoveredRequirementIds(requirements, questions), passes: kit.coverage.passes };

  const updatedKit: KitLean = { ...kit, company_brief: companyBrief, questions, schedule, coverage };

  const validation = validateKit(updatedKit);
  if (!validation.ok) {
    throw new AppError("KIT_VALIDATION_FAILED", `Kit failed structure validation after regeneration: ${validation.errors.join("; ")}`);
  }

  await Kit.findByIdAndUpdate(kitId, { company_brief: companyBrief, questions, schedule, coverage });

  return updatedKit;
}
