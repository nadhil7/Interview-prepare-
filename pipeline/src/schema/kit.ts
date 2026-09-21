import { z } from "zod";

/**
 * Zod schema mirroring the AI Interview Prep Kit contract exactly (field names,
 * required-ness, enums). Additive fields (`origin`, `status`) are optional with
 * defaults so the schema stays a strict superset of the graded structure.
 *
 * This is the single source of truth for kit shape — reused by the backend save
 * path and the CLI output writer. Do not duplicate these checks elsewhere.
 */

export const requirementKindSchema = z.enum(["technical", "behavioural", "domain"]);
export const requirementPrioritySchema = z.enum(["must", "nice"]);
export const questionCategorySchema = z.enum([
  "technical",
  "behavioural",
  "system-design",
  "company-fit",
]);
export const itemOriginSchema = z.enum(["generated", "user"]);
export const itemStatusSchema = z.enum(["pristine", "edited", "pinned"]);

export const requirementSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  kind: requirementKindSchema,
  priority: requirementPrioritySchema,
});

export const questionSchema = z.object({
  id: z.string().min(1),
  requirement_ids: z.array(z.string().min(1)),
  category: questionCategorySchema,
  prompt: z.string().min(1),
  answer_outline: z.string(),
  difficulty: z.number().int().min(1).max(3),
  origin: itemOriginSchema.default("generated"),
  status: itemStatusSchema.default("pristine"),
});

export const flashcardSchema = z.object({
  id: z.string().min(1),
  front: z.string().min(1),
  back: z.string().min(1),
  requirement_ids: z.array(z.string().min(1)),
  origin: itemOriginSchema.default("generated"),
  status: itemStatusSchema.default("pristine"),
});

export const scheduleDaySchema = z.object({
  day: z.number().int().min(1),
  focus: z.string(),
  question_ids: z.array(z.string().min(1)),
  minutes: z.number().int().min(0),
});

export const sourceSchema = z.object({
  company: z.string(),
  company_url: z.string(),
  role: z.string(),
  location: z.string(),
  jd_chars: z.number().int().min(0),
  researched_at: z.string(),
  pages_used: z.array(z.string()),
});

export const companyBriefSchema = z.object({
  summary: z.string(),
  what_they_do: z.string(),
  sources: z.array(z.string()),
});

export const roleSchema = z.object({
  title: z.string(),
  seniority: z.string(),
  responsibilities: z.array(z.string()),
  requirements: z.array(requirementSchema),
});

export const scheduleSchema = z.object({
  days_available: z.number().int().min(1).max(60),
  days: z.array(scheduleDaySchema),
});

export const coverageSchema = z.object({
  uncovered_requirement_ids: z.array(z.string()),
  passes: z.number().int().min(0),
});

export const kitSchema = z
  .object({
    source: sourceSchema,
    company_brief: companyBriefSchema,
    role: roleSchema,
    questions: z.array(questionSchema),
    flashcards: z.array(flashcardSchema),
    schedule: scheduleSchema,
    coverage: coverageSchema,
  })
  .superRefine((kit, ctx) => {
    const questionIds = new Set(kit.questions.map((q) => q.id));

    for (const day of kit.schedule.days) {
      for (const qid of day.question_ids) {
        if (!questionIds.has(qid)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `schedule.days[day=${day.day}] references unknown question_id "${qid}"`,
            path: ["schedule", "days"],
          });
        }
      }
    }

    const scheduledQuestionIds = new Set(kit.schedule.days.flatMap((d) => d.question_ids));

    for (const req of kit.role.requirements) {
      if (req.priority !== "must") continue;

      const coveringQuestionIds = kit.questions
        .filter((q) => q.requirement_ids.includes(req.id))
        .map((q) => q.id);

      if (coveringQuestionIds.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `must-priority requirement "${req.id}" has no referencing question`,
          path: ["role", "requirements"],
        });
        continue;
      }

      const appearsInSchedule = coveringQuestionIds.some((qid) => scheduledQuestionIds.has(qid));
      if (!appearsInSchedule) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `must-priority requirement "${req.id}" has questions but none are scheduled`,
          path: ["schedule", "days"],
        });
      }
    }
  });

export type Kit = z.infer<typeof kitSchema>;
export type Requirement = z.infer<typeof requirementSchema>;
export type Question = z.infer<typeof questionSchema>;
export type Flashcard = z.infer<typeof flashcardSchema>;

export type ValidateKitResult =
  | { ok: true; data: Kit }
  | { ok: false; errors: string[] };

export function validateKit(input: unknown): ValidateKitResult {
  const result = kitSchema.safeParse(input);
  if (result.success) {
    return { ok: true, data: result.data };
  }
  return {
    ok: false,
    errors: result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
  };
}
