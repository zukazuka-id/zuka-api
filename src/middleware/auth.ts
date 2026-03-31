import { auth } from "../lib/auth.js";
import type { Context, Next } from "hono";
import { db } from "../db/index.js";
import { accountRole } from "../db/schema.js";
import { eq } from "drizzle-orm";

type UserVars = {
  user: { id: string; name: string; email: string; [key: string]: unknown };
  session: { id: string; token: string; [key: string]: unknown };
  userRoles: { role: string; outletId: string }[];
};

export async function getSession(c: Context) {
  const session = await auth.api.getSession({
    headers: c.req.raw.headers,
  });
  return session;
}

export async function requireAuth(c: Context<{ Variables: UserVars }>, next: Next) {
  const session = await getSession(c);
  if (!session) {
    return c.json({ error: { code: "UNAUTHORIZED", message: "Authentication required" } }, 401);
  }
  c.set("user", session.user as UserVars["user"]);
  c.set("session", session.session as UserVars["session"]);
  await next();
}

export function requireRole(...roles: string[]) {
  return async (c: Context<{ Variables: UserVars }>, next: Next) => {
    const session = await getSession(c);
    if (!session) {
      return c.json({ error: { code: "UNAUTHORIZED", message: "Authentication required" } }, 401);
    }
    c.set("user", session.user as UserVars["user"]);
    c.set("session", session.session as UserVars["session"]);

    const userRoles = await db
      .select({ role: accountRole.role, outletId: accountRole.outletId })
      .from(accountRole)
      .where(eq(accountRole.accountId, session.user.id));

    const hasRole = userRoles.some((r) => roles.includes(r.role));
    if (!hasRole) {
      return c.json({ error: { code: "FORBIDDEN", message: "Insufficient permissions" } }, 403);
    }
    c.set("userRoles", userRoles);
    await next();
  };
}
