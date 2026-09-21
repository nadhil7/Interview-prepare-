import type { NextFunction, Request, Response } from "express";
import { AppError } from "../orchestration/errors.js";

/**
 * the one place errors get turned into responses. an AppError becomes a
 * plain {error: {code, message}} body the frontend can read and show,
 * anything else becomes a generic 500 with no stack trace sent to the
 * client. the real error still gets logged on the server for debugging.
 */
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: err.toJSON() });
    return;
  }

  console.error("unhandled error", err);
  res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Something went wrong." } });
}
