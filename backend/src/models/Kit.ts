import { Schema, model } from "mongoose";

/**
 * Mirrors the Kit contract in `pipeline/src/schema/kit.ts` field-for-field, plus
 * orchestration bookkeeping (`job`, `requestHash`) and per-item edit-tracking
 * (`origin`, `status`) that the Zod schema also allows additively.
 *
 * Keep this in sync with the Zod schema by hand — the round-trip test in
 * `src/__tests__/kit-mongoose-zod.test.ts` catches drift between the two.
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
