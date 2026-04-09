import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { db } from "../db/index.js";
import { invite, inviteRedemption, platformConfig, subscription } from "../db/schema.js";
import { eq, and, gte, desc, sql } from "drizzle-orm";
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

// Helper: get midnight WIB (UTC+7) as a Date
function getTodayStartWIB(): Date {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const wib = new Date(utc + 7 * 3600000);
  wib.setHours(0, 0, 0, 0);
  return new Date(wib.getTime() - 7 * 3600000);
}

// Helper: get tomorrow midnight WIB as ISO string
function getTomorrowMidnightWIB(): string {
  const start = getTodayStartWIB();
  return new Date(start.getTime() + 24 * 60 * 60 * 1000).toISOString();
}

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

// GET /invites/dashboard — member invite dashboard
inviteRoutes.get("/dashboard", requireAuth, async (c) => {
  const user = c.get("user") as UserVars["user"];

  // 1. Codes
  const codes = await db
    .select()
    .from(invite)
    .where(eq(invite.referrerId, user.id))
    .orderBy(desc(invite.createdAt))
    .limit(50);

  // 2. Stats
  const [statsRow] = await db
    .select({
      totalCodes: sql<number>`count(DISTINCT ${invite.id})::int`,
      claimed: sql<number>`count(DISTINCT ${inviteRedemption.id}) FILTER (WHERE ${inviteRedemption.phase} = 'claimed')::int`,
      consumed: sql<number>`count(DISTINCT ${inviteRedemption.id}) FILTER (WHERE ${inviteRedemption.phase} = 'consumed')::int`,
    })
    .from(invite)
    .leftJoin(inviteRedemption, eq(inviteRedemption.inviteId, invite.id))
    .where(eq(invite.referrerId, user.id));

  // 3. Quota
  const todayStart = getTodayStartWIB();

  const [quotaRow] = await db
    .select({ value: platformConfig.value })
    .from(platformConfig)
    .where(eq(platformConfig.key, "daily_invite_limit"))
    .limit(1);

  const dailyLimit = quotaRow ? parseInt(quotaRow.value, 10) : 10;

  const [{ todayCount }] = await db
    .select({ todayCount: sql<number>`count(*)::int` })
    .from(invite)
    .where(and(eq(invite.referrerId, user.id), gte(invite.createdAt, todayStart)));

  return success(c, {
    codes,
    stats: {
      totalCodes: statsRow?.totalCodes ?? 0,
      claimed: statsRow?.claimed ?? 0,
      consumed: statsRow?.consumed ?? 0,
    },
    quota: {
      usedToday: todayCount,
      limit: dailyLimit,
      resetsAt: getTomorrowMidnightWIB(),
    },
  });
});

export { inviteRoutes };
