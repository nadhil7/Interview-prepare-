import type { GeminiClientConfig } from "@aipk/pipeline";
import cookieParser from "cookie-parser";
import cors from "cors";
import express, { type Express } from "express";
import { requireAuth } from "./middleware/auth.js";
import { errorHandler } from "./middleware/error-handler.js";
import { createAuthRouter } from "./routes/auth.js";
import { createKitsRouter } from "./routes/kits.js";

export interface CreateAppOptions {
  jwtSecret: string;
  geminiConfig: GeminiClientConfig;
  urlValidatorOptions: { blockPrivateNetworks: boolean };
}

export function createApp(options: CreateAppOptions): Express {
  const app = express();

  app.use(cors({ credentials: true, origin: true }));
  app.use(express.json());
  app.use(cookieParser());

  app.get("/health", (_req, res) => res.status(200).json({ status: "ok" }));

  app.use("/api/auth", createAuthRouter(options.jwtSecret));
  app.use(
    "/api/kits",
    requireAuth(options.jwtSecret),
    createKitsRouter({ geminiConfig: options.geminiConfig, urlValidatorOptions: options.urlValidatorOptions }),
  );

  app.use(errorHandler);

  return app;
}
