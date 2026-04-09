import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { db } from "../db/index.js";
import { invite, subscription } from "../db/schema.js";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "../middleware/auth.js";
import { success, error } from "../lib/response.js";
import { validateInvite } from "../lib/invite-service.js";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { generateInvitesSchema, validateInviteSchema } from "../validators/index.js";
import crypto from "crypto";

type UserVars = {
  user: { id: string; name: string; email: string; [key: string]: unknown };
  session: { id: string; token: string; [key: string]: unknown };
  userRoles: { role: string; outletId: string }[];
};

const inviteRoutes = new Hono<{ Variables: UserVars }>();

function generateCode(length = 8): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  const bytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i++) {
    code += chars[bytes[i] % chars.length];
  }
  return code;
}

// POST /invites/generate — member with active subscription
inviteRoutes.post("/generate", requireAuth, zValidator("json", generateInvitesSchema), async (c) => {
  const user = c.get("user") as UserVars["user"];
  const { count } = c.req.valid("json");

  const [sub] = await db
    .select()
    .from(subscription)
    .where(and(eq(subscription.accountId, user.id), eq(subscription.status, "active")))
    .limit(1);

  if (!sub) {
    return error(c, "SUBSCRIPTION_REQUIRED", "Active subscription required to generate invites", 403);
  }

  const codes: { id: string; code: string }[] = [];
  await db.transaction(async (tx) => {
    for (let i = 0; i < count; i++) {
      const code = generateCode();
      const [inv] = await tx
        .insert(invite)
        .values({
          code,
          referrerId: user.id,
          status: "active",
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        })
        .returning();
      codes.push({ id: inv.id, code: inv.code });
    }
  });

  return success(c, codes, 201);
});

// POST /invites/redeem — public, validation only (no DB writes)
inviteRoutes.post("/redeem", zValidator("json", validateInviteSchema), async (c) => {
  const { code } = c.req.valid("json");
  const result = await validateInvite(code);

  if (!result.valid) {
    return error(c, result.code, result.message, result.status as ContentfulStatusCode);
  }

  return success(c, {
    valid: true,
    code: result.invite.code,
    type: result.invite.type,
  });
});

export { inviteRoutes };
