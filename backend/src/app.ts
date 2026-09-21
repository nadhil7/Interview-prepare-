import cookieParser from "cookie-parser";
import cors from "cors";
import express, { type Express } from "express";
import { requireAuth } from "./middleware/auth.js";
import { createAuthRouter } from "./routes/auth.js";
import { createKitsRouter } from "./routes/kits.js";

export function createApp(jwtSecret: string): Express {
  const app = express();

  app.use(cors({ credentials: true, origin: true }));
  app.use(express.json());
  app.use(cookieParser());

  app.get("/health", (_req, res) => res.status(200).json({ status: "ok" }));

  app.use("/api/auth", createAuthRouter(jwtSecret));
  app.use("/api/kits", requireAuth(jwtSecret), createKitsRouter());

  return app;
}
