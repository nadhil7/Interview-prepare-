import { createApp } from "./app.js";
import { loadEnv } from "./config/env.js";
import { connectDb } from "./db/connect.js";

async function main() {
  const env = loadEnv();
  await connectDb(env.MONGODB_URI);

  const app = createApp(env.JWT_SECRET);
  app.listen(env.PORT, () => {
    console.log(`backend listening on port ${env.PORT}`);
  });
}

main().catch((err) => {
  console.error("failed to start backend", err);
  process.exit(1);
});
