import { Hono } from "hono";
import { db } from "../db/index.js";
import { redemption, outlet, subscription, account } from "../db/schema.js";
import { eq, and, gte, sql, desc } from "drizzle-orm";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { success, paginated, error } from "../lib/response.js";
import crypto from "crypto";

type UserVars = {
  user: { id: string; name: string; email: string; [key: string]: unknown };
  session: { id: string; token: string; [key: string]: unknown };
  userRoles: { role: string; outletId: string }[];
};

const redemptionRoutes = new Hono<{ Variables: UserVars }>();

// POST /redemptions/create — member creates a redemption
redemptionRoutes.post("/create", requireAuth, async (c) => {
  const user = c.get("user") as UserVars["user"];
  const body = await c.req.json();
  const { outletId } = body;

  if (!outletId) {
    return error(c, "VALIDATION_ERROR", "outletId is required", 400);
  }

  // Check active subscription
  const [sub] = await db
    .select()
    .from(subscription)
    .where(and(eq(subscription.accountId, user.id), eq(subscription.status, "active")))
    .limit(1);

  if (!sub) {
    return error(c, "SUBSCRIPTION_REQUIRED", "Active subscription required to redeem", 403);
  }

  // Check outlet is open and active
  const [out] = await db
    .select()
    .from(outlet)
    .where(and(eq(outlet.id, outletId), eq(outlet.status, "active")))
    .limit(1);

  if (!out || !out.isOpen) {
    return error(c, "INVALID_OUTLET", "Outlet is not available", 400);
  }

  // Check not already redeemed at this outlet this year
  const yearStart = new Date(new Date().getFullYear(), 0, 1);
  const existing = await db
    .select()
    .from(redemption)
    .where(
      and(
        eq(redemption.accountId, user.id),
        eq(redemption.outletId, outletId),
        gte(redemption.createdAt, yearStart)
      )
    )
    .limit(1);

  if (existing.length > 0) {
    return error(c, "ALREADY_REDEEMED", "Already redeemed at this outlet this year", 409);
  }

  const qrToken = crypto.randomBytes(8).toString("hex");
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

  const [red] = await db
    .insert(redemption)
    .values({
      accountId: user.id,
      outletId,
      qrToken,
      status: "pending",
    })
    .returning();

  return success(c, { id: red.id, qrToken, expiresAt: expiresAt.toISOString() }, 201);
});

// POST /redemptions/verify — merchant verifies a QR token
redemptionRoutes.post("/verify", requireRole("owner", "manager", "staff"), async (c) => {
  const body = await c.req.json();
  const { qrToken } = body;

  if (!qrToken) {
    return error(c, "VALIDATION_ERROR", "qrToken is required", 400);
  }

  const [red] = await db
    .select()
    .from(redemption)
    .where(eq(redemption.qrToken, qrToken))
    .limit(1);

  if (!red) {
    return error(c, "NOT_FOUND", "Invalid QR token", 404);
  }

  if (red.status === "confirmed") {
    return error(c, "ALREADY_REDEEMED", "This QR code has already been redeemed", 409);
  }

  const createdAt = new Date(red.createdAt);
  if (Date.now() - createdAt.getTime() > 5 * 60 * 1000) {
    await db.update(redemption).set({ status: "expired" }).where(eq(redemption.id, red.id));
    return error(c, "EXPIRED", "QR code has expired", 410);
  }

  const [updated] = await db
    .update(redemption)
    .set({ status: "confirmed", redeemedAt: new Date() })
    .where(eq(redemption.id, red.id))
    .returning();

  const [member] = await db.select({ name: account.name }).from(account).where(eq(account.id, red.accountId)).limit(1);
  const [out] = await db.select({ label: outlet.label }).from(outlet).where(eq(outlet.id, red.outletId)).limit(1);

  return success(c, { redemption: updated, member, outlet: out });
});

// GET /redemptions/my — member's redemption history
redemptionRoutes.get("/my", requireAuth, async (c) => {
  const user = c.get("user") as UserVars["user"];
  const statusFilter = c.req.query("status");
  const page = parseInt(c.req.query("page") || "1");
  const limit = Math.min(parseInt(c.req.query("limit") || "20"), 50);
  const offset = (page - 1) * limit;

  const conditions = [eq(redemption.accountId, user.id)];
  if (statusFilter) {
    conditions.push(eq(redemption.status, statusFilter));
  }

  const where = and(...conditions);

  const [results, countResult] = await Promise.all([
    db
      .select({
        id: redemption.id,
        qrToken: redemption.qrToken,
        status: redemption.status,
        redeemedAt: redemption.redeemedAt,
        createdAt: redemption.createdAt,
        outletLabel: outlet.label,
        outletAddress: outlet.address,
      })
      .from(redemption)
      .leftJoin(outlet, eq(redemption.outletId, outlet.id))
      .where(where)
      .orderBy(desc(redemption.createdAt))
      .limit(limit)
      .offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(redemption).where(where),
  ]);

  const total = Number(countResult[0]?.count || 0);
  return paginated(c, results, { page, limit, total });
});

// GET /redemptions/today — today's redemptions for merchant's outlet
redemptionRoutes.get("/today", requireRole("owner", "manager", "staff"), async (c) => {
  const userRoles = c.get("userRoles") as UserVars["userRoles"];
  const outletId = c.req.query("outletId") || userRoles[0]?.outletId;

  if (!outletId) {
    return error(c, "VALIDATION_ERROR", "outletId is required", 400);
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const results = await db
    .select({
      id: redemption.id,
      qrToken: redemption.qrToken,
      status: redemption.status,
      redeemedAt: redemption.redeemedAt,
      createdAt: redemption.createdAt,
      memberName: account.name,
    })
    .from(redemption)
    .leftJoin(account, eq(redemption.accountId, account.id))
    .where(and(eq(redemption.outletId, outletId), gte(redemption.createdAt, today)))
    .orderBy(desc(redemption.createdAt));

  return success(c, results);
});

export { redemptionRoutes };
