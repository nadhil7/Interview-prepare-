import { z } from "zod";
import { scheduleDaySchema, type Question, type Requirement } from "../schema/kit.js";

export type ScheduleDay = z.infer<typeof scheduleDaySchema>;

export interface ScheduleResult {
  days_available: number;
  days: ScheduleDay[];
}

/** Fixed difficulty -> minutes mapping, integers only, per the contract. */
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

/** Must-linked requirements outrank nice, higher difficulty breaks ties within the same priority tier. */
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
 * Pure, deterministic — coverage and scheduling are never left to the
 * model. Scores every question (must outranks nice, difficulty breaks
 * ties), sorts descending, then walks the sorted list in contiguous
 * chunks — day 1 gets the first (hardest/highest-priority) chunk, day 2
 * the next, and so on — so harder material clusters into earlier days
 * rather than the night before the interview. Always emits exactly
 * `daysAvailable` day entries (1-60), even with far fewer questions than
 * days, and never drops a question, so any must-requirement's covering
 * question is guaranteed to land somewhere in the schedule.
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
