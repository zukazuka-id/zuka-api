import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { requireAdmin } from "../middleware/admin.js";
import { db } from "../db/index.js";
import { success, error } from "../lib/response.js";
import {
  adminCreateInvitesSchema,
  adminMembersQuerySchema,
  adminRestaurantsQuerySchema,
  adminRedemptionsQuerySchema,
  adminInvitesQuerySchema,
} from "../validators/index.js";
import {
  user,
  session,
  subscription,
  redemption,
  invite,
  outlet,
  restaurant,
  accountRole,
} from "../db/schema.js";
import { eq, sql, and, desc, ilike, like, gte, lte, count } from "drizzle-orm";

const adminRoutes = new Hono();

// ─── A1: Members ────────────────────────────────────────────

adminRoutes.get("/members", requireAdmin, zValidator("query", adminMembersQuerySchema), async (c) => {
  const { search, status, page, limit } = c.req.valid("query");
  const offset = (page - 1) * limit;

  const conditions = [];
  if (search) {
    conditions.push(
      sql`(${user.name} ILIKE ${`%${search}%`} OR ${user.email} ILIKE ${`%${search}%`} OR ${user.phoneNumber} ILIKE ${`%${search}%`})`
    );
  }
  if (status) {
    conditions.push(eq(user.emailVerified, status === "verified"));
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [members, totalResult] = await Promise.all([
    db.select({
      id: user.id,
      name: user.name,
      email: user.email,
      phoneNumber: user.phoneNumber,
      emailVerified: user.emailVerified,
      createdAt: user.createdAt,
    })
      .from(user)
      .where(where)
      .orderBy(desc(user.createdAt))
      .limit(limit)
      .offset(offset),
    db.select({ count: count() }).from(user).where(where),
  ]);

  return success(c, { members, total: totalResult[0]?.count ?? 0, page, limit });
});

adminRoutes.get("/members/:id", requireAdmin, async (c) => {
  const { id } = c.req.param();

  const [member] = await db.select({
    id: user.id,
    name: user.name,
    email: user.email,
    phoneNumber: user.phoneNumber,
    emailVerified: user.emailVerified,
    createdAt: user.createdAt,
  }).from(user).where(eq(user.id, id)).limit(1);

  if (!member) return error(c, "NOT_FOUND", "Member not found", 404);

  const subs = await db.select().from(subscription).where(eq(subscription.accountId, id)).orderBy(desc(subscription.createdAt));
  const reds = await db.select({
    id: redemption.id,
    outletId: redemption.outletId,
    status: redemption.status,
    redeemedAt: redemption.redeemedAt,
    createdAt: redemption.createdAt,
  }).from(redemption).where(eq(redemption.accountId, id)).orderBy(desc(redemption.createdAt)).limit(20);

  const sent = await db.select({
    id: invite.id,
    code: invite.code,
    status: invite.status,
    type: invite.type,
    maxRedemptions: invite.maxRedemptions,
    redeemedCount: invite.redeemedCount,
    createdAt: invite.createdAt,
  }).from(invite).where(eq(invite.referrerId, id)).orderBy(desc(invite.createdAt));

  return success(c, { ...member, subscriptions: subs, redemptions: reds, invites: sent });
});

// ─── A2: Restaurants ────────────────────────────────────────

adminRoutes.get("/restaurants", requireAdmin, zValidator("query", adminRestaurantsQuerySchema), async (c) => {
  const { search, status, cuisine, page, limit } = c.req.valid("query");
  const offset = (page - 1) * limit;

  const conditions = [];
  if (search) {
    conditions.push(ilike(restaurant.name, `%${search}%`));
  }
  if (status) {
    conditions.push(eq(outlet.status, status));
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [restaurants, totalResult] = await Promise.all([
    db.select({
      id: restaurant.id,
      name: restaurant.name,
      description: restaurant.description,
      cuisineTags: restaurant.cuisineTags,
      halalCertified: restaurant.halalCertified,
      logo: restaurant.logo,
      createdAt: restaurant.createdAt,
      outletCount: count(outlet.id),
    })
      .from(restaurant)
      .leftJoin(outlet, eq(outlet.restaurantId, restaurant.id))
      .where(where)
      .groupBy(restaurant.id)
      .orderBy(desc(restaurant.createdAt))
      .limit(limit)
      .offset(offset),
    db.select({ count: count() }).from(restaurant).where(where),
  ]);

  return success(c, { restaurants, total: totalResult[0]?.count ?? 0, page, limit });
});

adminRoutes.get("/restaurants/:id", requireAdmin, async (c) => {
  const { id } = c.req.param();

  const [rest] = await db.select().from(restaurant).where(eq(restaurant.id, id)).limit(1);
  if (!rest) return error(c, "NOT_FOUND", "Restaurant not found", 404);

  const outlets = await db.select().from(outlet).where(eq(outlet.restaurantId, id));

  return success(c, { ...rest, outlets });
});

// ─── A3: Redemptions ────────────────────────────────────────

adminRoutes.get("/redemptions", requireAdmin, zValidator("query", adminRedemptionsQuerySchema), async (c) => {
  const { memberId, outletId, status, startDate, endDate, page, limit } = c.req.valid("query");
  const offset = (page - 1) * limit;

  const conditions = [];
  if (memberId) conditions.push(eq(redemption.accountId, memberId));
  if (outletId) conditions.push(eq(redemption.outletId, outletId));
  if (status) conditions.push(eq(redemption.status, status));
  if (startDate) conditions.push(gte(redemption.createdAt, new Date(startDate)));
  if (endDate) conditions.push(lte(redemption.createdAt, new Date(endDate)));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [redemptions, totalResult] = await Promise.all([
    db.select({
      id: redemption.id,
      accountId: redemption.accountId,
      outletId: redemption.outletId,
      status: redemption.status,
      redeemedAt: redemption.redeemedAt,
      createdAt: redemption.createdAt,
    })
      .from(redemption)
      .where(where)
      .orderBy(desc(redemption.createdAt))
      .limit(limit)
      .offset(offset),
    db.select({ count: count() }).from(redemption).where(where),
  ]);

  return success(c, { redemptions, total: totalResult[0]?.count ?? 0, page, limit });
});

// ─── A4: Invite Codes ────────────────────────────────────────

adminRoutes.get("/invites", requireAdmin, zValidator("query", adminInvitesQuerySchema), async (c) => {
  const { status, referrerId, page, limit } = c.req.valid("query");
  const offset = (page - 1) * limit;

  const conditions = [];
  if (status) conditions.push(eq(invite.status, status));
  if (referrerId) conditions.push(eq(invite.referrerId, referrerId));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [invites, totalResult] = await Promise.all([
    db.select({
      id: invite.id,
      code: invite.code,
      status: invite.status,
      type: invite.type,
      referrerId: invite.referrerId,
      maxRedemptions: invite.maxRedemptions,
      redeemedCount: invite.redeemedCount,
      expiresAt: invite.expiresAt,
      createdAt: invite.createdAt,
    })
      .from(invite)
      .where(where)
      .orderBy(desc(invite.createdAt))
      .limit(limit)
      .offset(offset),
    db.select({ count: count() }).from(invite).where(where),
  ]);

  return success(c, { invites, total: totalResult[0]?.count ?? 0, page, limit });
});

adminRoutes.post("/invites/create", requireAdmin, zValidator("json", adminCreateInvitesSchema), async (c) => {
  const { referrerId, count, expiresDays, type, maxRedemptions } = c.req.valid("json");

  // Verify referrer exists
  const [referrer] = await db.select({ id: user.id }).from(user).where(eq(user.id, referrerId)).limit(1);
  if (!referrer) return error(c, "NOT_FOUND", "Referrer not found", 404);

  const expiresAt = new Date(Date.now() + expiresDays * 24 * 60 * 60 * 1000);
  const codes = [];
  for (let i = 0; i < count; i++) {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const code = Array.from(crypto.randomBytes(8)).map(b => chars[b % chars.length]).join("");
    const [created] = await db.insert(invite).values({
      code,
      referrerId,
      type,
      maxRedemptions: type === "multi_use" ? maxRedemptions : null,
      status: "active",
      expiresAt,
    }).returning({ id: invite.id, code: invite.code });
    codes.push(created);
  }

  return success(c, codes, 201);
});

adminRoutes.post("/invites/:id/deactivate", requireAdmin, async (c) => {
  const { id } = c.req.param();
  const [updated] = await db.update(invite)
    .set({ status: "inactive" })
    .where(eq(invite.id, id))
    .returning();

  if (!updated) return error(c, "NOT_FOUND", "Invite not found", 404);
  return success(c, updated);
});

adminRoutes.post("/invites/:id/reactivate", requireAdmin, async (c) => {
  const { id } = c.req.param();
  const [updated] = await db.update(invite)
    .set({ status: "active" })
    .where(eq(invite.id, id))
    .returning();

  if (!updated) return error(c, "NOT_FOUND", "Invite not found", 404);
  return success(c, updated);
});

// ─── A5: Dashboard ──────────────────────────────────────────

adminRoutes.get("/dashboard", requireAdmin, async (c) => {
  const [totalMembers] = await db.select({ count: count() }).from(user);
  const [activeSubs] = await db.select({ count: count() })
    .from(subscription)
    .where(eq(subscription.status, "active"));
  const [totalRestaurants] = await db.select({ count: count() }).from(restaurant);
  const [totalRedemptions] = await db.select({ count: count() }).from(redemption);
  const [totalInvites] = await db.select({ count: count() }).from(invite);

  // Recent signups (last 7 days)
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [recentSignups] = await db.select({ count: count() })
    .from(user)
    .where(gte(user.createdAt, sevenDaysAgo));

  return success(c, {
    totalMembers: totalMembers?.count ?? 0,
    activeSubscriptions: activeSubs?.count ?? 0,
    totalRestaurants: totalRestaurants?.count ?? 0,
    totalRedemptions: totalRedemptions?.count ?? 0,
    totalInvites: totalInvites?.count ?? 0,
    recentSignups: recentSignups?.count ?? 0,
  });
});

export { adminRoutes };
