import type { Hono } from "hono";

type Variables = {
  user: { id: string; name: string; email: string; [key: string]: unknown };
  session: { id: string; token: string; [key: string]: unknown };
  userRoles: { role: string; outletId: string }[];
};

export type AppType = Hono<{ Variables: Variables }>;
