import { Router } from "express";
import { Kit } from "../models/Kit.js";
import type { AuthedRequest } from "../middleware/auth.js";

/**
 * Phase 1 stub: proves the auth middleware is wired end-to-end. Full CRUD,
 * job orchestration, and section-level regeneration land in Phase 5.
 */
export function createKitsRouter(): Router {
  const router = Router();

  router.get("/", async (req: AuthedRequest, res) => {
    const kits = await Kit.find({ userId: req.userId }).lean();
    res.status(200).json(kits);
  });

  return router;
}
