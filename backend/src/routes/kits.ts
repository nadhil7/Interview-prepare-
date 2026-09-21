import type { GeminiClientConfig } from "@aipk/pipeline";
import { validateKit } from "@aipk/pipeline";
import type { NextFunction, Request, Response } from "express";
import { Router } from "express";
import { z } from "zod";
import type { AuthedRequest } from "../middleware/auth.js";
import { findOrCreateKitJob, runGenerationJob } from "../orchestration/generate-kit.js";
import { AppError } from "../orchestration/errors.js";
import { isRegenerableSection, regenerateSection } from "../orchestration/regenerate-section.js";
import { Kit } from "../models/Kit.js";

const createKitSchema = z.object({
  jd: z.string().min(1, "job description is required"),
  companyUrl: z.string().url("companyUrl must be a valid URL"),
  days: z.number().int().min(1).max(60),
});

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

  return router;
}
