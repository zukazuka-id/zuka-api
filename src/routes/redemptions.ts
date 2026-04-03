import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { db } from "../db/index.js";
import { redemption, outlet, subscription, user } from "../db/schema.js";
import { eq, and, gte, sql, desc } from "drizzle-orm";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { success, paginated, error } from "../lib/response.js";
import { createRedemptionSchema, verifyRedemptionSchema } from "../validators/index.js";
import crypto from "crypto";

type UserVars = {
  user: { id: string; name: string; email: string; [key: string]: unknown };
  session: { id: string; token: string; [key: string]: unknown };
  userRoles: { role: string; outletId: string }[];
};

const redemptionRoutes = new Hono<{ Variables: UserVars }>();

// POST /redemptions/create — member creates a redemption
redemptionRoutes.post("/create", requireAuth, zValidator("json", createRedemptionSchema), async (c) => {
  const user = c.get("user") as UserVars["user"];
  const { outletId } = c.req.valid("json");

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

  // Wrap in transaction to prevent duplicate redemptions under concurrency
  const yearStart = new Date(new Date().getFullYear(), 0, 1);
  const qrToken = crypto.randomBytes(8).toString("hex");
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

  const result = await db.transaction(async (tx) => {
    const existing = await tx
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
      return null;
    }

    const [red] = await tx
      .insert(redemption)
      .values({
        accountId: user.id,
        outletId,
        qrToken,
        status: "pending",
      })
      .returning();

    return red;
  });

  if (!result) {
    return error(c, "ALREADY_REDEEMED", "Already redeemed at this outlet this year", 409);
  }

  return success(c, { id: result.id, qrToken, expiresAt: expiresAt.toISOString() }, 201);
});

// POST /redemptions/verify — merchant verifies a QR token
redemptionRoutes.post("/verify", requireRole("owner", "manager", "staff"), zValidator("json", verifyRedemptionSchema), async (c) => {
  const userRoles = c.get("userRoles") as UserVars["userRoles"];
  const { qrToken } = c.req.valid("json");

  const [red] = await db
    .select()
    .from(redemption)
    .where(eq(redemption.qrToken, qrToken))
    .limit(1);

  if (!red) {
    return error(c, "NOT_FOUND", "Invalid QR token", 404);
  }

  // C4: Check outlet access — merchant must have access to this outlet
  const hasOutletAccess = userRoles.some((r) => r.outletId === red.outletId);
  if (!hasOutletAccess) {
    return error(c, "FORBIDDEN", "You do not have access to this outlet", 403);
  }

  if (red.status === "confirmed") {
    return error(c, "ALREADY_REDEEMED", "This QR code has already been redeemed", 409);
  }

  if (red.status === "expired" || red.status === "cancelled") {
    return error(c, "INVALID_REDEMPTION", `Redemption is ${red.status}`, 400);
  }

  const createdAt = new Date(red.createdAt);
  if (Date.now() - createdAt.getTime() > 5 * 60 * 1000) {
    await db.update(redemption).set({ status: "expired" }).where(eq(redemption.id, red.id));
    return error(c, "EXPIRED", "QR code has expired", 410);
  }

  // C3: Conditional UPDATE prevents double-verification under concurrency
  const updatedRows = await db
    .update(redemption)
    .set({ status: "confirmed", redeemedAt: new Date() })
    .where(and(eq(redemption.id, red.id), eq(redemption.status, "pending")))
    .returning();

  if (updatedRows.length === 0) {
    return error(c, "ALREADY_REDEEMED", "This QR code has already been redeemed", 409);
  }

  const updated = updatedRows[0];
  const [member] = await db.select({ name: user.name }).from(user).where(eq(user.id, red.accountId)).limit(1);
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

  // Verify merchant has access to this outlet
  const hasAccess = userRoles.some((r) => r.outletId === outletId);
  if (!hasAccess) {
    return error(c, "FORBIDDEN", "You do not have access to this outlet", 403);
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
      memberName: user.name,
    })
    .from(redemption)
    .leftJoin(user, eq(redemption.accountId, user.id))
    .where(and(eq(redemption.outletId, outletId), gte(redemption.createdAt, today)))
    .orderBy(desc(redemption.createdAt));

  return success(c, results);
});

// GET /redemptions/status/:qrToken — poll redemption status (member app)
redemptionRoutes.get("/status/:qrToken", requireAuth, async (c) => {
  const user = c.get("user") as UserVars["user"];
  const qrToken = c.req.param("qrToken");
  if (!qrToken) {
    return error(c, "VALIDATION_ERROR", "qrToken is required", 400);
  }

  const [red] = await db
    .select()
    .from(redemption)
    .where(and(eq(redemption.qrToken, qrToken), eq(redemption.accountId, user.id)))
    .limit(1);

  if (!red) {
    return error(c, "NOT_FOUND", "Redemption not found", 404);
  }

  if (red.status === "confirmed") {
    const [out] = await db
      .select({ label: outlet.label })
      .from(outlet)
      .where(eq(outlet.id, red.outletId))
      .limit(1);

    return success(c, {
      status: "confirmed",
      redemption: {
        id: red.id,
        memberId: red.accountId,
        restaurantId: red.outletId,
        restaurantName: out?.label ?? "Restoran",
        restaurantPhoto: null,
        redemptionNumber: 1,
        limit: 1,
        timestamp: (red.redeemedAt ?? red.createdAt).toISOString(),
        tokenHash: red.qrToken,
      },
    });
  }

  // Check expiry (5 min)
  const createdAt = new Date(red.createdAt);
  if (Date.now() - createdAt.getTime() > 5 * 60 * 1000) {
    await db
      .update(redemption)
      .set({ status: "expired" })
      .where(eq(redemption.id, red.id));
    return success(c, { status: "expired" });
  }

  return success(c, { status: "pending" });
});

export { redemptionRoutes };
