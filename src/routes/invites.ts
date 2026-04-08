import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { db } from "../db/index.js";
import { invite, inviteRedemption, subscription } from "../db/schema.js";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "../middleware/auth.js";
import { success, error } from "../lib/response.js";
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

  const [inv] = await db
    .select()
    .from(invite)
    .where(eq(invite.code, code.toUpperCase()))
    .limit(1);

  if (!inv) {
    return error(c, "NOT_FOUND", "Invalid invite code", 404);
  }

  if (inv.status !== "active") {
    return error(c, "INVALID_CODE", "This invite code is no longer active", 400);
  }

  if (inv.expiresAt && new Date(inv.expiresAt) < new Date()) {
    return error(c, "EXPIRED", "This invite code has expired", 410);
  }

  // For single_use: check if any redemption exists (claimed or consumed)
  if (inv.type === "single_use") {
    const [existing] = await db
      .select({ id: inviteRedemption.id })
      .from(inviteRedemption)
      .where(eq(inviteRedemption.inviteId, inv.id))
      .limit(1);

    if (existing) {
      return error(c, "ALREADY_REDEEMED", "This invite code has already been used", 409);
    }
  }

  // For multi_use: check redeemed_count < maxRedemptions (skip if maxRedemptions is null)
  if (inv.type === "multi_use" && inv.maxRedemptions !== null && inv.redeemedCount >= inv.maxRedemptions) {
    return error(c, "LIMIT_REACHED", "This invite code has reached its redemption limit", 409);
  }

  return success(c, {
    valid: true,
    code: inv.code,
    type: inv.type,
  });
});

export { inviteRoutes };
