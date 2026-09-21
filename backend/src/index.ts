import { createApp } from "./app.js";
import { loadEnv } from "./config/env.js";
import { connectDb } from "./db/connect.js";
import { buildGeminiConfig } from "./orchestration/gemini-config.js";

async function main() {
  const env = loadEnv();
  await connectDb(env.MONGODB_URI);

  const app = createApp({
    jwtSecret: env.JWT_SECRET,
    geminiConfig: buildGeminiConfig(env),
    urlValidatorOptions: { blockPrivateNetworks: env.NODE_ENV === "production" },
  });
  app.listen(env.PORT, () => {
    console.log(`backend listening on port ${env.PORT}`);
  });
}

main().catch((err) => {
  console.error("failed to start backend", err);
  process.exit(1);
});
