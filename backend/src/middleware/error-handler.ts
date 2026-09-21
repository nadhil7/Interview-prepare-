import type { NextFunction, Request, Response } from "express";
import { AppError } from "../orchestration/errors.js";

/**
 * Central error handler: turns AppError into a structured
 * {error:{code,message}} response the frontend can branch/render on, and
 * anything else into a generic 500 with no stack trace leaked to the
 * client (the real error is logged server-side for debugging).
 */
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: err.toJSON() });
    return;
  }

  console.error("unhandled error", err);
  res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Something went wrong." } });
}
