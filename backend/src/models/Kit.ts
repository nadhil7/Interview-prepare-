import { Schema, model } from "mongoose";

/**
 * matches the kit contract in pipeline/src/schema/kit.ts field by field,
 * plus job status and request hash for tracking a job, and origin and
 * status on each item for tracking edits, which the zod schema also
 * allows since it is additive.
 *
 * this needs to be kept in sync with the zod schema by hand. the round
 * trip test in src/__tests__/kit-mongoose-zod.test.ts will catch it if
 * the two drift apart.
 */

const requirementSchema = new Schema(
  {
    id: { type: String, required: true },
    text: { type: String, required: true },
    kind: { type: String, enum: ["technical", "behavioural", "domain"], required: true },
    priority: { type: String, enum: ["must", "nice"], required: true },
  },
  { _id: false },
);

const questionSchema = new Schema(
  {
    id: { type: String, required: true },
    requirement_ids: { type: [String], default: [] },
    category: {
      type: String,
      enum: ["technical", "behavioural", "system-design", "company-fit"],
      required: true,
    },
    prompt: { type: String, required: true },
    answer_outline: { type: String, default: "" },
    difficulty: { type: Number, required: true, min: 1, max: 3 },
    origin: { type: String, enum: ["generated", "user"], default: "generated" },
    status: { type: String, enum: ["pristine", "edited", "pinned"], default: "pristine" },
  },
  { _id: false },
);

const flashcardSchema = new Schema(
  {
    id: { type: String, required: true },
    front: { type: String, required: true },
    back: { type: String, required: true },
    requirement_ids: { type: [String], default: [] },
    origin: { type: String, enum: ["generated", "user"], default: "generated" },
    status: { type: String, enum: ["pristine", "edited", "pinned"], default: "pristine" },
    confidence: { type: Number, enum: [1, 2, 3], default: null },
    seen: { type: Boolean, default: false },
  },
  { _id: false },
);

const scheduleDaySchema = new Schema(
  {
    day: { type: Number, required: true },
    focus: { type: String, default: "" },
    question_ids: { type: [String], default: [] },
    minutes: { type: Number, required: true },
  },
  { _id: false },
);

const kitSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    requestHash: { type: String, index: true },

    /**
     * the raw research the llm calls were based on, kept around so
     * regenerating a section, the brief or a question category, reuses
     * the same material instead of crawling the company site or running
     * the search again every time. this is extra, not part of the strict
     * kit contract, and gets stripped out by validateKit automatically.
     */
    research: {
      pages: { type: [{ url: String, text: String }], default: [] },
      hiringProcessNotes: { type: String, default: "" },
    },

    job: {
      status: {
        type: String,
        enum: ["pending", "researching", "generating", "checking", "ready", "failed"],
        default: "pending",
      },
      progress: { type: Number, default: 0 },
      error: { type: Schema.Types.Mixed, default: null },
    },

    source: {
      company: { type: String, default: "" },
      company_url: { type: String, default: "" },
      role: { type: String, default: "" },
      location: { type: String, default: "" },
      jd_chars: { type: Number, default: 0 },
      researched_at: { type: String, default: "" },
      pages_used: { type: [String], default: [] },
    },

    company_brief: {
      summary: { type: String, default: "" },
      what_they_do: { type: String, default: "" },
      sources: { type: [String], default: [] },
    },

    role: {
      title: { type: String, default: "" },
      seniority: { type: String, default: "" },
      responsibilities: { type: [String], default: [] },
      requirements: { type: [requirementSchema], default: [] },
    },

    questions: { type: [questionSchema], default: [] },
    flashcards: { type: [flashcardSchema], default: [] },

    schedule: {
      days_available: { type: Number, default: 0 },
      days: { type: [scheduleDaySchema], default: [] },
    },

    coverage: {
      uncovered_requirement_ids: { type: [String], default: [] },
      passes: { type: Number, default: 0 },
    },
  },
  { timestamps: true },
);

export const Kit = model("Kit", kitSchema);
export type KitDocument = InstanceType<typeof Kit>;
