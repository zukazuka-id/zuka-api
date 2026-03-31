import "dotenv/config";
import { Hono } from "hono";
import { logger } from "hono/logger";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";

const app = new Hono();

// Middleware
app.use("*", logger());
app.use(
  "*",
  cors({
    origin: ["http://localhost:3000", "http://localhost:3001"],
    credentials: true,
  })
);

// Health check
app.get("/health", (c) => {
  return c.json({
    status: "ok",
    service: "zuka-api",
    version: "0.1.0",
    timestamp: new Date().toISOString(),
  });
});

// Routes will be mounted here
// app.route("/auth", authRoutes);
// app.route("/restaurants", restaurantRoutes);
// app.route("/redemptions", redemptionRoutes);
// app.route("/merchant", merchantRoutes);
// app.route("/subscription", subscriptionRoutes);
// app.route("/invites", inviteRoutes);

const port = parseInt(process.env.PORT || "3000");
console.log(`🚀 ZUKA API running on http://localhost:${port}`);

serve({ fetch: app.fetch, port });
