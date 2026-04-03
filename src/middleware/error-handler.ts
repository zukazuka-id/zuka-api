import type { Context } from "hono";
import { NotFoundError, ConflictError, UnauthorizedError, ForbiddenError, ValidationError } from "../lib/errors.js";

export function errorHandler(err: Error, c: Context) {
  console.error(`[Error] ${c.req.method} ${c.req.path}:`, err.message);

  // Check custom error classes first
  if (err instanceof NotFoundError) {
    return c.json({ error: { code: "NOT_FOUND", message: err.message } }, 404);
  }

  if (err instanceof ConflictError) {
    return c.json({ error: { code: "CONFLICT", message: err.message } }, 409);
  }

  if (err instanceof UnauthorizedError) {
    return c.json({ error: { code: "UNAUTHORIZED", message: err.message } }, 401);
  }

  if (err instanceof ForbiddenError) {
    return c.json({ error: { code: "FORBIDDEN", message: err.message } }, 403);
  }

  if (err instanceof ValidationError) {
    return c.json({ error: { code: "VALIDATION_ERROR", message: err.message } }, 400);
  }

  // Fallback: string matching for unhandled errors
  if (err.message?.includes("not found") || err.message?.includes("No row")) {
    return c.json({ error: { code: "NOT_FOUND", message: "Resource not found" } }, 404);
  }

  if (err.message?.includes("unique") || err.message?.includes("duplicate")) {
    return c.json({ error: { code: "CONFLICT", message: "Resource already exists" } }, 409);
  }

  if (err.message?.includes("unauthorized") || err.message?.includes("UNAUTHORIZED")) {
    return c.json({ error: { code: "UNAUTHORIZED", message: err.message } }, 401);
  }

  if (err.message?.includes("forbidden") || err.message?.includes("FORBIDDEN")) {
    return c.json({ error: { code: "FORBIDDEN", message: err.message } }, 403);
  }

  if (err.message?.includes("validation") || err.message?.includes("Invalid")) {
    return c.json({ error: { code: "VALIDATION_ERROR", message: err.message } }, 400);
  }

  return c.json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "An unexpected error occurred",
        ...(process.env.NODE_ENV === "development" && { details: err.message }),
      },
    },
    500
  );
}
