import { describe, expect, it } from "vitest";
import type { Question, Requirement } from "../../schema/kit.js";
import { allocateSchedule } from "../schedule-allocator.js";

function question(id: string, requirement_ids: string[], difficulty: 1 | 2 | 3, category: Question["category"] = "technical"): Question {
  return { id, requirement_ids, category, prompt: "p", answer_outline: "a", difficulty, origin: "generated", status: "pristine" };
}

const requirements: Requirement[] = [
  { id: "r1", text: "React", kind: "technical", priority: "must" },
  { id: "r2", text: "GraphQL", kind: "technical", priority: "nice" },
];

describe("allocateSchedule", () => {
  it("produces exactly the number of days requested, for a 1-day schedule", () => {
    const questions = [question("q1", ["r1"], 2), question("q2", ["r2"], 1)];
    const result = allocateSchedule(questions, requirements, 1);
    expect(result.days).toHaveLength(1);
    expect(result.days[0]!.question_ids.sort()).toEqual(["q1", "q2"]);
  });

  it("produces exactly the number of days requested, for a 60-day schedule with far fewer questions", () => {
    const questions = [question("q1", ["r1"], 2), question("q2", ["r2"], 1)];
    const result = allocateSchedule(questions, requirements, 60);
    expect(result.days).toHaveLength(60);
    expect(result.days_available).toBe(60);
    // every question still placed somewhere, none dropped
    const allIds = result.days.flatMap((d) => d.question_ids);
    expect(allIds.sort()).toEqual(["q1", "q2"]);
    // most days are empty buffer days
    expect(result.days.filter((d) => d.question_ids.length === 0).length).toBe(58);
  });

  it("always emits integer minutes per day", () => {
    const questions = [question("q1", ["r1"], 3), question("q2", ["r2"], 2), question("q3", [], 1)];
    const result = allocateSchedule(questions, requirements, 3);
    for (const day of result.days) {
      expect(Number.isInteger(day.minutes)).toBe(true);
    }
  });

  it("schedules every must-priority requirement's question somewhere in the plan", () => {
    const questions = [
      question("q1", ["r1"], 1), // must
      question("q2", ["r2"], 3), // nice
    ];
    const result = allocateSchedule(questions, requirements, 5);
    const scheduledQuestionIds = new Set(result.days.flatMap((d) => d.question_ids));
    expect(scheduledQuestionIds.has("q1")).toBe(true);
  });

  it("clusters must/high-difficulty questions into the earliest days ahead of nice/low-difficulty ones", () => {
    const questions = [
      question("easy-nice", ["r2"], 1),
      question("hard-must", ["r1"], 3),
      question("medium-must", ["r1"], 2),
    ];
    const result = allocateSchedule(questions, requirements, 3);
    // 3 questions over 3 days means 1 per day, day 1 should get the one that scored highest
    expect(result.days[0]!.question_ids).toEqual(["hard-must"]);
    expect(result.days[2]!.question_ids).toEqual(["easy-nice"]);
  });

  it("handles zero questions by still producing the requested number of empty days", () => {
    const result = allocateSchedule([], requirements, 4);
    expect(result.days).toHaveLength(4);
    expect(result.days.every((d) => d.question_ids.length === 0 && d.minutes === 0)).toBe(true);
  });

  it("labels a day's focus by the categories of questions scheduled that day", () => {
    const questions = [question("q1", ["r1"], 2, "technical"), question("q2", ["r2"], 1, "behavioural")];
    const result = allocateSchedule(questions, requirements, 1);
    expect(result.days[0]!.focus).toContain("Technical");
    expect(result.days[0]!.focus).toContain("Behavioural");
  });
});
