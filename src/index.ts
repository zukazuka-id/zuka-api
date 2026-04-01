import "dotenv/config";
import { serve } from "@hono/node-server";
import { app } from "./app.js";

const port = parseInt(process.env.PORT || "3000");
console.log(`🚀 ZUKA API running on http://localhost:${port}`);
console.log(`📖 API Docs: http://localhost:${port}/docs`);
serve({ fetch: app.fetch, port });
