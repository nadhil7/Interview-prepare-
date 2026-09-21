import type { GeminiClientConfig } from "@aipk/pipeline";
import { questionCategorySchema, validateKit } from "@aipk/pipeline";
import type { NextFunction, Request, Response } from "express";
import { Router } from "express";
import { z } from "zod";
import type { AuthedRequest } from "../middleware/auth.js";
import { findOrCreateKitJob, runGenerationJob } from "../orchestration/generate-kit.js";
import { AppError } from "../orchestration/errors.js";
import { isRegenerableSection, regenerateSection } from "../orchestration/regenerate-section.js";
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
import { Kit } from "../models/Kit.js";

const createKitSchema = z.object({
  jd: z.string().min(1, "job description is required"),
  companyUrl: z.string().url("companyUrl must be a valid URL"),
  days: z.number().int().min(1).max(60),
});

const difficultySchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);

const updateQuestionSchema = z.object({
  prompt: z.string().min(1).optional(),
  answer_outline: z.string().optional(),
  category: questionCategorySchema.optional(),
  difficulty: difficultySchema.optional(),
});

const createQuestionSchema = z.object({
  category: questionCategorySchema,
  prompt: z.string().min(1),
  answer_outline: z.string().optional(),
  difficulty: difficultySchema,
  requirement_ids: z.array(z.string()).optional(),
});

const reorderQuestionsSchema = z.object({
  category: questionCategorySchema,
  orderedIds: z.array(z.string()),
});

const updateFlashcardSchema = z.object({
  front: z.string().min(1).optional(),
  back: z.string().min(1).optional(),
});

const createFlashcardSchema = z.object({
  front: z.string().min(1),
  back: z.string().min(1),
  requirement_ids: z.array(z.string()).optional(),
});

const reorderFlashcardsSchema = z.object({
  orderedIds: z.array(z.string()),
});

const practiceUpdateSchema = z.object({
  confidence: z.union([z.literal(1), z.literal(2), z.literal(3), z.null()]).optional(),
  seen: z.boolean().optional(),
});

const updateCompanyBriefSchema = z.object({
  summary: z.string().optional(),
  what_they_do: z.string().optional(),
});

function parseOrThrow<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new AppError("INVALID_INPUT", parsed.error.issues.map((i) => i.message).join("; "));
  }
  return parsed.data;
}

/** express 4 does not send async errors to the error middleware on its own, so this does it instead. */
function asyncHandler(fn: (req: AuthedRequest, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req as AuthedRequest, res, next).catch(next);
  };
}

export interface KitsRouterDeps {
  geminiConfig: GeminiClientConfig;
  urlValidatorOptions: { blockPrivateNetworks: boolean };
}

export function createKitsRouter(deps: KitsRouterDeps): Router {
  const router = Router();

  router.get(
    "/",
    asyncHandler(async (req, res) => {
      const kits = await Kit.find({ userId: req.userId }).lean();
      res.status(200).json(kits);
    }),
  );

  router.post(
    "/",
    asyncHandler(async (req, res) => {
      const parsed = createKitSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError("INVALID_INPUT", parsed.error.issues.map((i) => i.message).join("; "));
      }

      const { kit, isNew } = await findOrCreateKitJob(req.userId!, {
        jd: parsed.data.jd,
        companyUrl: parsed.data.companyUrl,
        days: parsed.data.days,
      });

      if (isNew) {
        void runGenerationJob(
          kit.id,
          { jd: parsed.data.jd, companyUrl: parsed.data.companyUrl, days: parsed.data.days },
          deps.geminiConfig,
          deps.urlValidatorOptions,
        );
      }

      res.status(202).json(kit);
    }),
  );

  router.get(
    "/:id",
    asyncHandler(async (req, res) => {
      const kit = await Kit.findOne({ _id: req.params.id, userId: req.userId }).lean();
      if (!kit) throw new AppError("NOT_FOUND", "kit not found");

      if (kit.job?.status === "ready") {
        const validation = validateKit(kit);
        if (!validation.ok) {
          throw new AppError("KIT_VALIDATION_FAILED", `Stored kit failed structure validation: ${validation.errors.join("; ")}`);
        }
      }

      res.status(200).json(kit);
    }),
  );

  router.get(
    "/:id/progress",
    asyncHandler(async (req, res) => {
      const kit = await Kit.findOne({ _id: req.params.id, userId: req.userId }, "job").lean();
      if (!kit) throw new AppError("NOT_FOUND", "kit not found");
      res.status(200).json(kit.job);
    }),
  );

  router.post(
    "/:id/regenerate/:section",
    asyncHandler(async (req, res) => {
      const section = req.params.section ?? "";
      if (!isRegenerableSection(section)) {
        throw new AppError("INVALID_INPUT", `unknown section "${section}"`);
      }

      const updated = await regenerateSection(req.params.id!, req.userId!, section, deps.geminiConfig);
      res.status(200).json(updated);
    }),
  );

  router.post(
    "/:id/questions",
    asyncHandler(async (req, res) => {
      const input = parseOrThrow(createQuestionSchema, req.body);
      const updated = await createQuestion(req.params.id!, req.userId!, { ...input, answer_outline: input.answer_outline ?? "" });
      res.status(201).json(updated);
    }),
  );

  router.patch(
    "/:id/questions/order",
    asyncHandler(async (req, res) => {
      const { category, orderedIds } = parseOrThrow(reorderQuestionsSchema, req.body);
      const updated = await reorderQuestions(req.params.id!, req.userId!, category, orderedIds);
      res.status(200).json(updated);
    }),
  );

  router.patch(
    "/:id/questions/:questionId/pin",
    asyncHandler(async (req, res) => {
      const updated = await toggleQuestionPin(req.params.id!, req.userId!, req.params.questionId!);
      res.status(200).json(updated);
    }),
  );

  router.patch(
    "/:id/questions/:questionId",
    asyncHandler(async (req, res) => {
      const changes = parseOrThrow(updateQuestionSchema, req.body);
      const updated = await updateQuestion(req.params.id!, req.userId!, req.params.questionId!, changes);
      res.status(200).json(updated);
    }),
  );

  router.delete(
    "/:id/questions/:questionId",
    asyncHandler(async (req, res) => {
      const updated = await deleteQuestion(req.params.id!, req.userId!, req.params.questionId!);
      res.status(200).json(updated);
    }),
  );

  router.post(
    "/:id/flashcards",
    asyncHandler(async (req, res) => {
      const input = parseOrThrow(createFlashcardSchema, req.body);
      const updated = await createFlashcard(req.params.id!, req.userId!, input);
      res.status(201).json(updated);
    }),
  );

  router.patch(
    "/:id/flashcards/order",
    asyncHandler(async (req, res) => {
      const { orderedIds } = parseOrThrow(reorderFlashcardsSchema, req.body);
      const updated = await reorderFlashcards(req.params.id!, req.userId!, orderedIds);
      res.status(200).json(updated);
    }),
  );

  router.patch(
    "/:id/flashcards/:cardId/pin",
    asyncHandler(async (req, res) => {
      const updated = await toggleFlashcardPin(req.params.id!, req.userId!, req.params.cardId!);
      res.status(200).json(updated);
    }),
  );

  router.patch(
    "/:id/flashcards/:cardId/practice",
    asyncHandler(async (req, res) => {
      const input = parseOrThrow(practiceUpdateSchema, req.body);
      const updated = await updateFlashcardPractice(req.params.id!, req.userId!, req.params.cardId!, input);
      res.status(200).json(updated);
    }),
  );

  router.patch(
    "/:id/flashcards/:cardId",
    asyncHandler(async (req, res) => {
      const changes = parseOrThrow(updateFlashcardSchema, req.body);
      const updated = await updateFlashcard(req.params.id!, req.userId!, req.params.cardId!, changes);
      res.status(200).json(updated);
    }),
  );

  router.delete(
    "/:id/flashcards/:cardId",
    asyncHandler(async (req, res) => {
      const updated = await deleteFlashcard(req.params.id!, req.userId!, req.params.cardId!);
      res.status(200).json(updated);
    }),
  );

  router.patch(
    "/:id/company-brief",
    asyncHandler(async (req, res) => {
      const changes = parseOrThrow(updateCompanyBriefSchema, req.body);
      const updated = await updateCompanyBrief(req.params.id!, req.userId!, changes);
      res.status(200).json(updated);
    }),
  );

  return router;
}
