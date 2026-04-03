import "dotenv/config";
import * as Sentry from "@sentry/node";
import { serve } from "@hono/node-server";
import { app } from "./app.js";
import { client } from "./db/index.js";

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || "development",
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,
  });
}

const port = parseInt(process.env.PORT || "3000");
console.log(`🚀 ZUKA API running on http://localhost:${port}`);
console.log(`📖 API Docs: http://localhost:${port}/docs`);

const server = serve({ fetch: app.fetch, port });

// Graceful shutdown — close DB connections on SIGTERM/SIGINT
async function shutdown() {
  console.log("\nShutting down gracefully...");
  server.close();
  await client.end();
  console.log("DB connections closed. Goodbye.");
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
