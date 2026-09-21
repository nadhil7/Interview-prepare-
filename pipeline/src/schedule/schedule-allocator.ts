import { z } from "zod";
import { scheduleDaySchema, type Question, type Requirement } from "../schema/kit.js";

export type ScheduleDay = z.infer<typeof scheduleDaySchema>;

export interface ScheduleResult {
  days_available: number;
  days: ScheduleDay[];
}

/** fixed table mapping difficulty to minutes, whole numbers only, matching the contract. */
const DIFFICULTY_MINUTES: Record<number, number> = { 1: 20, 2: 35, 3: 50 };

const CATEGORY_LABELS: Record<Question["category"], string> = {
  technical: "Technical",
  behavioural: "Behavioural",
  "system-design": "System Design",
  "company-fit": "Company Fit",
};

function priorityRank(question: Question, requirementById: Map<string, Requirement>): number {
  let rank = 0;
  for (const id of question.requirement_ids) {
    const req = requirementById.get(id);
    if (req?.priority === "must") return 2;
    if (req?.priority === "nice") rank = Math.max(rank, 1);
  }
  return rank;
}

/** a question tied to a must requirement always outranks one tied to a nice one, difficulty breaks ties within the same tier. */
export function scoreQuestion(question: Question, requirementById: Map<string, Requirement>): number {
  return priorityRank(question, requirementById) * 10 + question.difficulty;
}

function minutesFor(question: Question): number {
  return DIFFICULTY_MINUTES[question.difficulty] ?? DIFFICULTY_MINUTES[1]!;
}

function focusLabelFor(dayQuestions: Question[]): string {
  if (dayQuestions.length === 0) return "Light review / buffer day";
  const labels: string[] = [];
  for (const q of dayQuestions) {
    const label = CATEGORY_LABELS[q.category];
    if (!labels.includes(label)) labels.push(label);
  }
  return labels.join(", ");
}

/**
 * plain, predictable code. coverage and scheduling are never left to the
 * model. it scores every question, must outranks nice and difficulty
 * breaks ties, sorts them highest first, then walks that list in chunks.
 * day one gets the first and hardest chunk, day two gets the next, and so
 * on, so harder material lands early rather than the night before the
 * interview. it always produces exactly as many days as requested, from
 * one day up to sixty, even when there are far fewer questions than days,
 * and it never drops a question, so any must requirement's question is
 * guaranteed a spot somewhere in the schedule.
 */
export function allocateSchedule(
  questions: Question[],
  requirements: Requirement[],
  daysAvailable: number,
): ScheduleResult {
  const requirementById = new Map(requirements.map((r) => [r.id, r]));
  const sorted = [...questions].sort(
    (a, b) => scoreQuestion(b, requirementById) - scoreQuestion(a, requirementById),
  );

  const total = sorted.length;
  const baseCount = Math.floor(total / daysAvailable);
  const remainder = total % daysAvailable;

  const days: ScheduleDay[] = [];
  let cursor = 0;
  for (let day = 1; day <= daysAvailable; day++) {
    const count = baseCount + (day <= remainder ? 1 : 0);
    const dayQuestions = sorted.slice(cursor, cursor + count);
    cursor += count;

    days.push({
      day,
      focus: focusLabelFor(dayQuestions),
      question_ids: dayQuestions.map((q) => q.id),
      minutes: dayQuestions.reduce((sum, q) => sum + minutesFor(q), 0),
    });
  }

  return { days_available: daysAvailable, days };
}
