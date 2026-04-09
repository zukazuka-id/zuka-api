import type { Context, Next } from "hono";
import { getSession } from "./auth.js";

type AdminVars = {
  admin: { id: string; name: string; email: string; role: string; banned: boolean | null; [key: string]: unknown };
  session: { id: string; token: string; [key: string]: unknown };
};

export async function requireAdmin(
  c: Context<{ Variables: AdminVars }>,
  next: Next
) {
  const session = await getSession(c);
  if (!session) {
    return c.json(
      { error: { code: "UNAUTHORIZED", message: "Authentication required" } },
      401
    );
  }

  const user = session.user as AdminVars["admin"];

  if (user.banned) {
    if (user.banExpires && new Date(user.banExpires) < new Date()) {
      // Ban expired — allow access
    } else {
      return c.json(
        { error: { code: "FORBIDDEN", message: "Account is banned" } },
        403
      );
    }
  }

  if (user.role !== "admin") {
    return c.json(
      { error: { code: "FORBIDDEN", message: "Admin access required" } },
      403
    );
  }

  c.set("admin", user);
  c.set("session", session.session as AdminVars["session"]);
  await next();
}
