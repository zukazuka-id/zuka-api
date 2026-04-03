import type { Context, Next } from "hono";

// NOTE: In-memory rate limiting resets on cold start in serverless environments.
// For multi-instance deployments, consider using Upstash Redis or similar.
// This implementation includes periodic cleanup to prevent memory leaks.

const requests = new Map<string, { count: number; resetAt: number }>();

// Periodic cleanup: evict expired entries every 60 seconds
const CLEANUP_INTERVAL = 60_000;
let lastCleanup = Date.now();

function cleanup() {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL) return;
  lastCleanup = now;
  for (const [key, entry] of requests) {
    if (now > entry.resetAt) {
      requests.delete(key);
    }
  }
}

interface RateLimitOptions {
  windowMs: number;
  maxRequests: number;
}

export function rateLimiter(options: RateLimitOptions = { windowMs: 60_000, maxRequests: 100 }) {
  return async (c: Context, next: Next) => {
    cleanup();
    const ip = c.req.header("x-forwarded-for") || c.req.header("x-real-ip") || "unknown";
    const now = Date.now();

    const entry = requests.get(ip);
    if (!entry || now > entry.resetAt) {
      requests.set(ip, { count: 1, resetAt: now + options.windowMs });
      await next();
      return;
    }

    entry.count++;
    if (entry.count > options.maxRequests) {
      return c.json(
        { error: { code: "RATE_LIMITED", message: "Too many requests. Please try again later." } },
        429
      );
    }

    await next();
  };
}

export const authRateLimiter = rateLimiter({ windowMs: 60_000, maxRequests: 20 });
export const strictRateLimiter = rateLimiter({ windowMs: 60_000, maxRequests: 10 });
export const moderateRateLimiter = rateLimiter({ windowMs: 60_000, maxRequests: 30 });
