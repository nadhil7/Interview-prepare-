import {
  allocateSchedule,
  findUncoveredRequirementIds,
  validateKit,
  type Flashcard,
  type Kit as KitContract,
  type Question,
  type QuestionCategory,
} from "@aipk/pipeline";
import { Kit } from "../models/Kit.js";
import { AppError } from "./errors.js";
import { nextIndexFor } from "./ids.js";

interface KitLean extends KitContract {
  _id: unknown;
  job: { status: string; progress: number; error: unknown };
}

async function loadReadyKit(kitId: string, userId: string): Promise<KitLean> {
  const doc = await Kit.findOne({ _id: kitId, userId }).lean();
  if (!doc) throw new AppError("NOT_FOUND", "kit not found");
  const kit = doc as unknown as KitLean;
  if (kit.job.status !== "ready") {
    throw new AppError("KIT_NOT_READY", `kit is not ready for editing (current status: ${kit.job.status})`);
  }
  return kit;
}

function assertValid(updated: KitLean): void {
  const validation = validateKit(updated);
  if (!validation.ok) {
    throw new AppError("KIT_VALIDATION_FAILED", `kit failed structure validation after edit: ${validation.errors.join("; ")}`);
  }
}

/**
 * every question array change goes through here so the schedule and
 * coverage always stay in sync with the questions that actually exist,
 * the same rule regenerateSection already follows.
 */
async function persistQuestions(kitId: string, kit: KitLean, questions: Question[]): Promise<KitLean> {
  const requirements = kit.role.requirements;
  const schedule = allocateSchedule(questions, requirements, kit.schedule.days_available);
  const coverage = { uncovered_requirement_ids: findUncoveredRequirementIds(requirements, questions), passes: kit.coverage.passes };
  const updated: KitLean = { ...kit, questions, schedule, coverage };
  assertValid(updated);
  await Kit.findByIdAndUpdate(kitId, { questions, schedule, coverage });
  return updated;
}

async function persistFlashcards(kitId: string, kit: KitLean, flashcards: Flashcard[]): Promise<KitLean> {
  const updated: KitLean = { ...kit, flashcards };
  assertValid(updated);
  await Kit.findByIdAndUpdate(kitId, { flashcards });
  return updated;
}

export interface QuestionEditInput {
  prompt?: string;
  answer_outline?: string;
  category?: QuestionCategory;
  difficulty?: 1 | 2 | 3;
}

export async function updateQuestion(kitId: string, userId: string, questionId: string, changes: QuestionEditInput): Promise<KitLean> {
  const kit = await loadReadyKit(kitId, userId);
  let found = false;
  const questions = kit.questions.map((q) => {
    if (q.id !== questionId) return q;
    found = true;
    return { ...q, ...changes, status: q.status === "pinned" ? "pinned" : "edited" } as Question;
  });
  if (!found) throw new AppError("NOT_FOUND", "question not found");
  return persistQuestions(kitId, kit, questions);
}

export interface NewQuestionInput {
  category: QuestionCategory;
  prompt: string;
  answer_outline: string;
  difficulty: 1 | 2 | 3;
  requirement_ids?: string[];
}

/** a hand added question is marked edited, not pristine, so a later category regeneration never wipes it. */
export async function createQuestion(kitId: string, userId: string, input: NewQuestionInput): Promise<KitLean> {
  const kit = await loadReadyKit(kitId, userId);
  const nextIndex = nextIndexFor(kit.questions.map((q) => q.id), "q");
  const newQuestion: Question = {
    id: `q${nextIndex}`,
    requirement_ids: input.requirement_ids ?? [],
    category: input.category,
    prompt: input.prompt,
    answer_outline: input.answer_outline,
    difficulty: input.difficulty,
    origin: "user",
    status: "edited",
  };
  return persistQuestions(kitId, kit, [...kit.questions, newQuestion]);
}

export async function deleteQuestion(kitId: string, userId: string, questionId: string): Promise<KitLean> {
  const kit = await loadReadyKit(kitId, userId);
  const questions = kit.questions.filter((q) => q.id !== questionId);
  if (questions.length === kit.questions.length) throw new AppError("NOT_FOUND", "question not found");
  return persistQuestions(kitId, kit, questions);
}

export async function reorderQuestions(kitId: string, userId: string, category: QuestionCategory, orderedIds: string[]): Promise<KitLean> {
  const kit = await loadReadyKit(kitId, userId);
  const inCategory = kit.questions.filter((q) => q.category === category);
  const others = kit.questions.filter((q) => q.category !== category);

  const sameSet = orderedIds.length === inCategory.length && inCategory.every((q) => orderedIds.includes(q.id));
  if (!sameSet) {
    throw new AppError("INVALID_INPUT", "orderedIds must match exactly the question ids currently in this category");
  }

  const byId = new Map(inCategory.map((q) => [q.id, q]));
  const reordered = orderedIds.map((id) => byId.get(id)!);
  return persistQuestions(kitId, kit, [...others, ...reordered]);
}

export async function toggleQuestionPin(kitId: string, userId: string, questionId: string): Promise<KitLean> {
  const kit = await loadReadyKit(kitId, userId);
  let found = false;
  const questions = kit.questions.map((q) => {
    if (q.id !== questionId) return q;
    found = true;
    return { ...q, status: q.status === "pinned" ? "edited" : "pinned" } as Question;
  });
  if (!found) throw new AppError("NOT_FOUND", "question not found");
  return persistQuestions(kitId, kit, questions);
}

export interface FlashcardEditInput {
  front?: string;
  back?: string;
}

export async function updateFlashcard(kitId: string, userId: string, cardId: string, changes: FlashcardEditInput): Promise<KitLean> {
  const kit = await loadReadyKit(kitId, userId);
  let found = false;
  const flashcards = kit.flashcards.map((f) => {
    if (f.id !== cardId) return f;
    found = true;
    return { ...f, ...changes, status: f.status === "pinned" ? "pinned" : "edited" } as Flashcard;
  });
  if (!found) throw new AppError("NOT_FOUND", "flashcard not found");
  return persistFlashcards(kitId, kit, flashcards);
}

export interface NewFlashcardInput {
  front: string;
  back: string;
  requirement_ids?: string[];
}

export async function createFlashcard(kitId: string, userId: string, input: NewFlashcardInput): Promise<KitLean> {
  const kit = await loadReadyKit(kitId, userId);
  const nextIndex = nextIndexFor(kit.flashcards.map((f) => f.id), "f");
  const newCard: Flashcard = {
    id: `f${nextIndex}`,
    front: input.front,
    back: input.back,
    requirement_ids: input.requirement_ids ?? [],
    origin: "user",
    status: "edited",
    confidence: null,
    seen: false,
  };
  return persistFlashcards(kitId, kit, [...kit.flashcards, newCard]);
}

export async function deleteFlashcard(kitId: string, userId: string, cardId: string): Promise<KitLean> {
  const kit = await loadReadyKit(kitId, userId);
  const flashcards = kit.flashcards.filter((f) => f.id !== cardId);
  if (flashcards.length === kit.flashcards.length) throw new AppError("NOT_FOUND", "flashcard not found");
  return persistFlashcards(kitId, kit, flashcards);
}

export async function reorderFlashcards(kitId: string, userId: string, orderedIds: string[]): Promise<KitLean> {
  const kit = await loadReadyKit(kitId, userId);
  const sameSet = orderedIds.length === kit.flashcards.length && kit.flashcards.every((f) => orderedIds.includes(f.id));
  if (!sameSet) {
    throw new AppError("INVALID_INPUT", "orderedIds must match exactly the flashcard ids in this kit");
  }
  const byId = new Map(kit.flashcards.map((f) => [f.id, f]));
  return persistFlashcards(kitId, kit, orderedIds.map((id) => byId.get(id)!));
}

export async function toggleFlashcardPin(kitId: string, userId: string, cardId: string): Promise<KitLean> {
  const kit = await loadReadyKit(kitId, userId);
  let found = false;
  const flashcards = kit.flashcards.map((f) => {
    if (f.id !== cardId) return f;
    found = true;
    return { ...f, status: f.status === "pinned" ? "edited" : "pinned" } as Flashcard;
  });
  if (!found) throw new AppError("NOT_FOUND", "flashcard not found");
  return persistFlashcards(kitId, kit, flashcards);
}

export interface PracticeUpdateInput {
  confidence?: 1 | 2 | 3 | null;
  seen?: boolean;
}

/** practice state never touches schedule or coverage, it does not affect either. */
export async function updateFlashcardPractice(kitId: string, userId: string, cardId: string, input: PracticeUpdateInput): Promise<KitLean> {
  const kit = await loadReadyKit(kitId, userId);
  let found = false;
  const flashcards = kit.flashcards.map((f) => {
    if (f.id !== cardId) return f;
    found = true;
    return {
      ...f,
      confidence: input.confidence !== undefined ? input.confidence : f.confidence,
      seen: input.seen !== undefined ? input.seen : f.seen,
    };
  });
  if (!found) throw new AppError("NOT_FOUND", "flashcard not found");
  return persistFlashcards(kitId, kit, flashcards);
}

export interface CompanyBriefEditInput {
  summary?: string;
  what_they_do?: string;
}

export async function updateCompanyBrief(kitId: string, userId: string, changes: CompanyBriefEditInput): Promise<KitLean> {
  const kit = await loadReadyKit(kitId, userId);
  const company_brief = { ...kit.company_brief, ...changes };
  const updated: KitLean = { ...kit, company_brief };
  assertValid(updated);
  await Kit.findByIdAndUpdate(kitId, { company_brief });
  return updated;
}
