import type { Context, Next } from "hono";

const ADMIN_API_KEY = process.env.ADMIN_API_KEY;

if (!ADMIN_API_KEY && process.env.NODE_ENV === "production") {
  throw new Error("ADMIN_API_KEY environment variable is required in production");
}

if (!ADMIN_API_KEY) {
  console.warn("[WARN] ADMIN_API_KEY not set — using insecure default. Set ADMIN_API_KEY before deploying.");
}

const effectiveKey = ADMIN_API_KEY || "dev-only-admin-key";

export async function requireAdmin(c: Context, next: Next) {
  const authHeader = c.req.header("Authorization");
  const apiKey = authHeader?.replace("Bearer ", "");

  if (!apiKey || apiKey !== effectiveKey) {
    return c.json({ error: { code: "UNAUTHORIZED", message: "Invalid admin API key" } }, 401);
  }

  await next();
}
