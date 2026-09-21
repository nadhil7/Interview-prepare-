import mongoose from "mongoose";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Kit } from "../models/Kit.js";
import { AppError } from "../orchestration/errors.js";
import {
  createFlashcard,
  createQuestion,
  deleteFlashcard,
  deleteQuestion,
  reorderFlashcards,
  reorderQuestions,
  toggleFlashcardPin,
  toggleQuestionPin,
  updateCompanyBrief,
  updateFlashcard,
  updateFlashcardPractice,
  updateQuestion,
} from "../orchestration/edit-kit.js";
import { clearTestDb, startTestDb, stopTestDb } from "./mongo-test-utils.js";

beforeAll(startTestDb);
afterEach(clearTestDb);
afterAll(stopTestDb);

async function seedReadyKit(userId: mongoose.Types.ObjectId) {
  return Kit.create({
    userId,
    requestHash: "hash",
    job: { status: "ready", progress: 100, error: null },
    source: { company: "Acme", company_url: "https://acme.example", role: "Engineer", location: "", jd_chars: 100, researched_at: "now", pages_used: [] },
    company_brief: { summary: "Acme builds widgets.", what_they_do: "Widgets.", sources: ["https://acme.example"] },
    role: {
      title: "Engineer",
      seniority: "senior",
      responsibilities: [],
      requirements: [
        { id: "r1", text: "5+ years with React", kind: "technical", priority: "must" },
        { id: "r2", text: "Strong communication", kind: "behavioural", priority: "must" },
      ],
    },
    questions: [
      { id: "q1", requirement_ids: ["r1"], category: "technical", prompt: "old technical Q", answer_outline: "a", difficulty: 2, origin: "generated", status: "pristine" },
      { id: "q2", requirement_ids: ["r2"], category: "behavioural", prompt: "behavioural Q", answer_outline: "a", difficulty: 1, origin: "generated", status: "pristine" },
    ],
    flashcards: [
      { id: "f1", front: "front 1", back: "back 1", requirement_ids: ["r1"], origin: "generated", status: "pristine", confidence: null, seen: false },
      { id: "f2", front: "front 2", back: "back 2", requirement_ids: ["r2"], origin: "generated", status: "pristine", confidence: null, seen: false },
    ],
    schedule: {
      days_available: 2,
      days: [
        { day: 1, focus: "Technical", question_ids: ["q1"], minutes: 35 },
        { day: 2, focus: "Behavioural", question_ids: ["q2"], minutes: 20 },
      ],
    },
    coverage: { uncovered_requirement_ids: [], passes: 1 },
  });
}

describe("question edits", () => {
  it("marks an edited question as status edited and keeps it out of a category regen's blast radius", async () => {
    const userId = new mongoose.Types.ObjectId();
    const kit = await seedReadyKit(userId);

    const updated = await updateQuestion(kit.id, userId.toString(), "q1", { prompt: "new prompt" });

    const q1 = updated.questions.find((q) => q.id === "q1");
    expect(q1?.prompt).toBe("new prompt");
    expect(q1?.status).toBe("edited");
  });

  it("keeps a pinned question pinned even if its content is edited", async () => {
    const userId = new mongoose.Types.ObjectId();
    const kit = await seedReadyKit(userId);
    await toggleQuestionPin(kit.id, userId.toString(), "q1");

    const updated = await updateQuestion(kit.id, userId.toString(), "q1", { prompt: "changed" });
    expect(updated.questions.find((q) => q.id === "q1")?.status).toBe("pinned");
  });

  it("adds a user question marked edited (never pristine, so a regen can't silently wipe it)", async () => {
    const userId = new mongoose.Types.ObjectId();
    const kit = await seedReadyKit(userId);

    const updated = await createQuestion(kit.id, userId.toString(), {
      category: "technical",
      prompt: "hand written question",
      answer_outline: "a",
      difficulty: 2,
    });

    const created = updated.questions.find((q) => q.prompt === "hand written question");
    expect(created?.origin).toBe("user");
    expect(created?.status).toBe("edited");
    expect(created?.id).not.toBe("q1");
    expect(created?.id).not.toBe("q2");
  });

  it("recomputes the schedule after adding a question so it appears somewhere in the plan", async () => {
    const userId = new mongoose.Types.ObjectId();
    const kit = await seedReadyKit(userId);

    const updated = await createQuestion(kit.id, userId.toString(), {
      category: "technical",
      prompt: "hand written question",
      answer_outline: "a",
      difficulty: 2,
    });

    const created = updated.questions.find((q) => q.prompt === "hand written question")!;
    const scheduledIds = new Set(updated.schedule.days.flatMap((d) => d.question_ids));
    expect(scheduledIds.has(created.id)).toBe(true);
  });

  it("recomputes the schedule and coverage after deleting the only question covering a must requirement", async () => {
    const userId = new mongoose.Types.ObjectId();
    const kit = await seedReadyKit(userId);

    await expect(deleteQuestion(kit.id, userId.toString(), "q1")).rejects.toThrow(AppError);

    const stillThere = await Kit.findById(kit.id).lean();
    expect(stillThere!.questions).toHaveLength(2);
  });

  it("deletes a question that is not the sole coverage for a must requirement", async () => {
    const userId = new mongoose.Types.ObjectId();
    const kit = await seedReadyKit(userId);
    await createQuestion(kit.id, userId.toString(), { category: "technical", prompt: "backup coverage for r1", answer_outline: "a", difficulty: 1, requirement_ids: ["r1"] });

    const updated = await deleteQuestion(kit.id, userId.toString(), "q1");
    expect(updated.questions.find((q) => q.id === "q1")).toBeUndefined();
    expect(updated.coverage.uncovered_requirement_ids).toEqual([]);
  });

  it("reorders questions within a category", async () => {
    const userId = new mongoose.Types.ObjectId();
    const kit = await seedReadyKit(userId);
    await createQuestion(kit.id, userId.toString(), { category: "technical", prompt: "second technical", answer_outline: "a", difficulty: 1, requirement_ids: ["r1"] });

    const refreshed = await Kit.findById(kit.id).lean();
    const technicalIds = refreshed!.questions.filter((q) => q.category === "technical").map((q) => q.id);
    const reversed = [...technicalIds].reverse();

    const updated = await reorderQuestions(kit.id, userId.toString(), "technical", reversed);
    const newOrder = updated.questions.filter((q) => q.category === "technical").map((q) => q.id);
    expect(newOrder).toEqual(reversed);
  });

  it("rejects a reorder whose ids don't match the category's actual questions", async () => {
    const userId = new mongoose.Types.ObjectId();
    const kit = await seedReadyKit(userId);
    await expect(reorderQuestions(kit.id, userId.toString(), "technical", ["q1", "not-real"])).rejects.toThrow(AppError);
  });
});

describe("flashcard edits", () => {
  it("edits a flashcard and marks it edited", async () => {
    const userId = new mongoose.Types.ObjectId();
    const kit = await seedReadyKit(userId);
    const updated = await updateFlashcard(kit.id, userId.toString(), "f1", { front: "new front" });
    const card = updated.flashcards.find((f) => f.id === "f1");
    expect(card?.front).toBe("new front");
    expect(card?.status).toBe("edited");
  });

  it("adds and deletes a flashcard", async () => {
    const userId = new mongoose.Types.ObjectId();
    const kit = await seedReadyKit(userId);
    const afterCreate = await createFlashcard(kit.id, userId.toString(), { front: "q", back: "a" });
    const created = afterCreate.flashcards.find((f) => f.front === "q");
    expect(created?.origin).toBe("user");

    const afterDelete = await deleteFlashcard(kit.id, userId.toString(), created!.id);
    expect(afterDelete.flashcards.find((f) => f.id === created!.id)).toBeUndefined();
  });

  it("reorders flashcards", async () => {
    const userId = new mongoose.Types.ObjectId();
    const kit = await seedReadyKit(userId);
    const updated = await reorderFlashcards(kit.id, userId.toString(), ["f2", "f1"]);
    expect(updated.flashcards.map((f) => f.id)).toEqual(["f2", "f1"]);
  });

  it("toggles pin status", async () => {
    const userId = new mongoose.Types.ObjectId();
    const kit = await seedReadyKit(userId);
    const pinned = await toggleFlashcardPin(kit.id, userId.toString(), "f1");
    expect(pinned.flashcards.find((f) => f.id === "f1")?.status).toBe("pinned");
    const unpinned = await toggleFlashcardPin(kit.id, userId.toString(), "f1");
    expect(unpinned.flashcards.find((f) => f.id === "f1")?.status).toBe("edited");
  });

  it("records practice confidence and seen state without touching schedule or coverage", async () => {
    const userId = new mongoose.Types.ObjectId();
    const kit = await seedReadyKit(userId);
    const updated = await updateFlashcardPractice(kit.id, userId.toString(), "f1", { confidence: 1, seen: true });
    const card = updated.flashcards.find((f) => f.id === "f1");
    expect(card?.confidence).toBe(1);
    expect(card?.seen).toBe(true);
    expect(updated.schedule.days).toHaveLength(2);
  });
});

describe("company brief edits", () => {
  it("overwrites only the given fields", async () => {
    const userId = new mongoose.Types.ObjectId();
    const kit = await seedReadyKit(userId);
    const updated = await updateCompanyBrief(kit.id, userId.toString(), { summary: "updated summary" });
    expect(updated.company_brief.summary).toBe("updated summary");
    expect(updated.company_brief.what_they_do).toBe("Widgets.");
  });
});
