import { createApp } from "./app.js";
import { loadEnv } from "./config/env.js";
import { connectDb } from "./db/connect.js";
import { buildGeminiConfig } from "./orchestration/gemini-config.js";
import { STALE_JOB_TIMEOUT_MS, sweepStaleJobs } from "./orchestration/generate-kit.js";

const STALE_JOB_SWEEP_INTERVAL_MS = 60 * 1000;

async function main() {
  const env = loadEnv();
  await connectDb(env.MONGODB_URI);

  // Recovers jobs orphaned by a crash/restart, then keeps sweeping so a job
  // that hangs without the process dying still gets caught.
  const staleOnStartup = await sweepStaleJobs();
  if (staleOnStartup > 0) {
    console.warn(`recovered ${staleOnStartup} stale job(s) left over from a previous run`);
  }
  setInterval(() => {
    sweepStaleJobs().catch((err) => console.error("stale job sweep failed", err));
  }, STALE_JOB_SWEEP_INTERVAL_MS).unref();

  const app = createApp({
    jwtSecret: env.JWT_SECRET,
    geminiConfig: buildGeminiConfig(env),
    urlValidatorOptions: { blockPrivateNetworks: env.NODE_ENV === "production" },
  });
  app.listen(env.PORT, () => {
    console.log(`backend listening on port ${env.PORT} (stale job timeout: ${STALE_JOB_TIMEOUT_MS}ms)`);
  });
}

main().catch((err) => {
  console.error("failed to start backend", err);
  process.exit(1);
});
