import type { Context, Next } from "hono";

const requests = new Map<string, { count: number; resetAt: number }>();

interface RateLimitOptions {
  windowMs: number;
  maxRequests: number;
}

export function rateLimiter(options: RateLimitOptions = { windowMs: 60_000, maxRequests: 100 }) {
  return async (c: Context, next: Next) => {
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
