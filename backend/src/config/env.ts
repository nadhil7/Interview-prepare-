import { DEFAULT_GEMINI_MODEL } from "@aipk/pipeline";
import { config as loadDotenv } from "dotenv";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { z } from "zod";

// loads the .env file from the repo root, not from wherever the process
// happens to be run from. npm run --workspace changes the working
// directory to the workspace folder, so relying on dotenv's default
// lookup would miss the root .env when this runs from inside backend
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../");
loadDotenv({ path: path.join(repoRoot, ".env") });

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().default(4000),
  MONGODB_URI: z.string().min(1, "MONGODB_URI is required"),
  JWT_SECRET: z.string().min(1, "JWT_SECRET is required"),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().min(1).default(DEFAULT_GEMINI_MODEL),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(overrides: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(overrides);
  if (!result.success) {
    const messages = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${messages.join("\n")}`);
  }
  return result.data;
}
