import { Hono } from "hono";
import { logger } from "hono/logger";
import { cors } from "hono/cors";
import { Scalar } from "@scalar/hono-api-reference";
import { db, sql } from "./db/index.js";
import { auth } from "./lib/auth.js";
import { errorHandler } from "./middleware/error-handler.js";
import { authRateLimiter, strictRateLimiter, moderateRateLimiter } from "./middleware/rate-limiter.js";
import { authRoutes } from "./routes/auth.js";
import { restaurantRoutes } from "./routes/restaurants.js";
import { redemptionRoutes } from "./routes/redemptions.js";
import { merchantRoutes } from "./routes/merchant.js";
import { subscriptionRoutes } from "./routes/subscription.js";
import { inviteRoutes } from "./routes/invites.js";
import { outletRoutes } from "./routes/outlets.js";
import { adminRoutes } from "./routes/admin.js";
import { configRoutes } from "./routes/config.js";
import { deviceRoutes } from "./routes/devices.js";
import { docsApp } from "./openapi-routes.js";

// ── OpenAPI Spec Generation ───────────────────────────────────
docsApp.openAPIRegistry.registerComponent("securitySchemes", "bearerAuth", {
  type: "http",
  scheme: "bearer",
  description: "Session token from login/register",
});

const openApiSpec = docsApp.getOpenAPI31Document({
  openapi: "3.1.0",
  info: {
    title: "ZUKA API",
    version: "0.1.0",
    description:
      "BOGO dining subscription API — members get buy-one-get-one deals at partner restaurants across Indonesia.",
  },
  servers: [
    { url: process.env.BETTER_AUTH_URL || "http://localhost:3000", description: "API server" },
  ],
});

type UserVars = {
  user: { id: string; name: string; email: string; [key: string]: unknown };
  session: { id: string; token: string; [key: string]: unknown };
  userRoles: { role: string; outletId: string }[];
};

export const app = new Hono<{ Variables: UserVars }>();

// Global middleware
app.use("*", logger());
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",")
  : ["http://localhost:3000", "http://localhost:3001", "http://localhost:7490", "http://localhost:7491"];

app.use("*", cors({ origin: ALLOWED_ORIGINS, credentials: true }));

// Global error handler
app.onError(errorHandler);

// Body size limit — reject oversized payloads
app.use("*", async (c, next) => {
  const contentLength = c.req.header("content-length");
  if (contentLength && parseInt(contentLength) > 1_000_000) {
    return c.json({ error: { code: "PAYLOAD_TOO_LARGE", message: "Request body exceeds 1MB limit" } }, 413);
  }
  await next();
});

// Health check with DB test
app.get("/health", async (c) => {
  try {
    await db.execute(sql`SELECT 1`);
    return c.json({ status: "ok", db: "connected", service: "zuka-api", version: "0.1.0", timestamp: new Date().toISOString() });
  } catch (err) {
    return c.json({ status: "degraded", db: "disconnected", service: "zuka-api", version: "0.1.0", error: err instanceof Error ? err.message : String(err), timestamp: new Date().toISOString() }, 503);
  }
});

// ── Scalar API Docs ───────────────────────────────────────────
app.get(
  "/docs",
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Scalar({
    url: "/openapi.json",
    theme: "purple",
    layout: "modern",
  } as any)
);

app.get("/openapi.json", (c) => c.json(openApiSpec));

// Better Auth handler — all /api/auth/* routes
app.on(["POST", "GET"], "/api/auth/*", (c) => auth.handler(c.req.raw));

// Rate limiting on custom auth routes
app.use("/api/v1/auth/*", authRateLimiter);

// Rate limiting on sensitive write endpoints
app.use("/api/v1/invites/redeem", strictRateLimiter);
app.use("/api/v1/redemptions/verify", strictRateLimiter);
app.use("/api/v1/subscription/create", moderateRateLimiter);
app.use("/api/v1/devices/register", strictRateLimiter);

// API v1 routes
app.route("/api/v1/auth", authRoutes);
app.route("/api/v1/restaurants", restaurantRoutes);
app.route("/api/v1/redemptions", redemptionRoutes);
app.route("/api/v1/merchant", merchantRoutes);
app.route("/api/v1/subscription", subscriptionRoutes);
app.route("/api/v1/invites", inviteRoutes);
app.route("/api/v1/outlets", outletRoutes);
app.route("/api/v1/admin", adminRoutes);
app.route("/api/v1/config", configRoutes);
app.route("/api/v1/devices", deviceRoutes);

export type AppType = typeof app;
