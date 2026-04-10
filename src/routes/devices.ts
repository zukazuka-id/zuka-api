import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { db } from "../db/index.js";
import { device } from "../db/schema.js";
import { requireAuth } from "../middleware/auth.js";
import { success } from "../lib/response.js";
import { registerDeviceSchema } from "../validators/index.js";
import crypto from "crypto";

type UserVars = {
  user: { id: string; name: string; email: string; [key: string]: unknown };
  session: { id: string; token: string; [key: string]: unknown };
  userRoles: { role: string; outletId: string }[];
};

const deviceRoutes = new Hono<{ Variables: UserVars }>();
deviceRoutes.use("*", requireAuth);

// POST /devices/register
deviceRoutes.post("/register", zValidator("json", registerDeviceSchema), async (c) => {
  const user = c.get("user") as UserVars["user"];
  const { token, platform } = c.req.valid("json");

  await db
    .insert(device)
    .values({
      id: crypto.randomUUID(),
      accountId: user.id,
      token,
      platform,
    })
    .onConflictDoUpdate({
      target: device.token,
      set: { accountId: user.id, platform, updatedAt: new Date() },
    });

  return success(c, { registered: true });
});

export { deviceRoutes };
