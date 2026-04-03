import { Hono } from "hono";
import { requireAdmin } from "../middleware/admin.js";
import { db } from "../db/index.js";
import { success, error } from "../lib/response.js";
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

adminRoutes.get("/members", requireAdmin, async (c) => {
  const { search, status, page = "1", limit = "20" } = c.req.query();
  const offset = (parseInt(page) - 1) * parseInt(limit);

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
      .limit(parseInt(limit))
      .offset(offset),
    db.select({ count: count() }).from(user).where(where),
  ]);

  return success(c, { members, total: totalResult[0]?.count ?? 0, page: parseInt(page), limit: parseInt(limit) });
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
    redeemerId: invite.redeemerId,
    createdAt: invite.createdAt,
  }).from(invite).where(eq(invite.referrerId, id)).orderBy(desc(invite.createdAt));

  return success(c, { ...member, subscriptions: subs, redemptions: reds, invites: sent });
});

// ─── A2: Restaurants ────────────────────────────────────────

adminRoutes.get("/restaurants", requireAdmin, async (c) => {
  const { search, status, cuisine, page = "1", limit = "20" } = c.req.query();
  const offset = (parseInt(page) - 1) * parseInt(limit);

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
      .limit(parseInt(limit))
      .offset(offset),
    db.select({ count: count() }).from(restaurant).where(where),
  ]);

  return success(c, { restaurants, total: totalResult[0]?.count ?? 0, page: parseInt(page), limit: parseInt(limit) });
});

adminRoutes.get("/restaurants/:id", requireAdmin, async (c) => {
  const { id } = c.req.param();

  const [rest] = await db.select().from(restaurant).where(eq(restaurant.id, id)).limit(1);
  if (!rest) return error(c, "NOT_FOUND", "Restaurant not found", 404);

  const outlets = await db.select().from(outlet).where(eq(outlet.restaurantId, id));

  return success(c, { ...rest, outlets });
});

// ─── A3: Redemptions ────────────────────────────────────────

adminRoutes.get("/redemptions", requireAdmin, async (c) => {
  const { memberId, outletId, status, startDate, endDate, page = "1", limit = "50" } = c.req.query();
  const offset = (parseInt(page) - 1) * parseInt(limit);

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
      .limit(parseInt(limit))
      .offset(offset),
    db.select({ count: count() }).from(redemption).where(where),
  ]);

  return success(c, { redemptions, total: totalResult[0]?.count ?? 0, page: parseInt(page), limit: parseInt(limit) });
});

// ─── A4: Invite Codes ────────────────────────────────────────

adminRoutes.get("/invites", requireAdmin, async (c) => {
  const { status, referrerId, page = "1", limit = "50" } = c.req.query();
  const offset = (parseInt(page) - 1) * parseInt(limit);

  const conditions = [];
  if (status) conditions.push(eq(invite.status, status));
  if (referrerId) conditions.push(eq(invite.referrerId, referrerId));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [invites, totalResult] = await Promise.all([
    db.select({
      id: invite.id,
      code: invite.code,
      status: invite.status,
      referrerId: invite.referrerId,
      redeemerId: invite.redeemerId,
      expiresAt: invite.expiresAt,
      redeemedAt: invite.redeemedAt,
      createdAt: invite.createdAt,
    })
      .from(invite)
      .where(where)
      .orderBy(desc(invite.createdAt))
      .limit(parseInt(limit))
      .offset(offset),
    db.select({ count: count() }).from(invite).where(where),
  ]);

  return success(c, { invites, total: totalResult[0]?.count ?? 0, page: parseInt(page), limit: parseInt(limit) });
});

adminRoutes.post("/invites/create", requireAdmin, async (c) => {
  const body = await c.req.json();
  const { referrerId, count = 1, expiresDays = 30 } = body;
  if (!referrerId) return error(c, "VALIDATION_ERROR", "referrerId is required", 400);

  const codes = [];
  for (let i = 0; i < Math.min(count, 100); i++) {
    const code = Array.from(crypto.getRandomValues(new Uint8Array(4))).map(b => b.toString(16).padStart(2, "0")).join("");
    const [created] = await db.insert(invite).values({
      code,
      referrerId,
      status: "active",
      expiresAt: new Date(Date.now() + expiresDays * 24 * 60 * 60 * 1000),
    }).returning();
    codes.push(created);
  }

  return success(c, codes, 201);
});

adminRoutes.post("/invites/:id/revoke", requireAdmin, async (c) => {
  const { id } = c.req.param();
  const [updated] = await db.update(invite)
    .set({ status: "expired" })
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
