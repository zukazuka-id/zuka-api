import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export function success<T>(c: Context, data: T, status: ContentfulStatusCode = 200) {
  return c.json({ success: true, data }, status);
}

export function error(c: Context, code: string, message: string, status: ContentfulStatusCode = 400) {
  return c.json({ success: false, error: { code, message } }, status);
}

export function paginated<T>(
  c: Context,
  data: T[],
  opts: { page: number; limit: number; total: number }
) {
  const totalPages = Math.ceil(opts.total / opts.limit);
  return c.json({
    success: true,
    data,
    pagination: {
      page: opts.page,
      limit: opts.limit,
      total: opts.total,
      totalPages,
      hasMore: opts.page < totalPages,
    },
  });
}
