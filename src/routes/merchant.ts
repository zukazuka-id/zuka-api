import { Hono } from "hono";
import { db } from "../db/index.js";
import { restaurant, outlet, redemption, user } from "../db/schema.js";
import { eq, and, gte, sql, desc } from "drizzle-orm";
import { requireRole } from "../middleware/auth.js";
import { success, error } from "../lib/response.js";

type UserVars = {
  user: { id: string; name: string; email: string; [key: string]: unknown };
  session: { id: string; token: string; [key: string]: unknown };
  userRoles: { role: string; outletId: string }[];
};

const merchantRoutes = new Hono<{ Variables: UserVars }>();

// All merchant routes require at least staff role
merchantRoutes.use("*", requireRole("owner", "manager", "staff"));

// GET /merchant/dashboard
merchantRoutes.get("/dashboard", async (c) => {
  const userRoles = c.get("userRoles") as UserVars["userRoles"];
  const outletId = c.req.query("outletId") || userRoles[0]?.outletId;

  if (!outletId) {
    return error(c, "VALIDATION_ERROR", "outletId is required", 400);
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const weekAgo = new Date(today);
  weekAgo.setDate(weekAgo.getDate() - 7);

  const [todayCount, weekCount, totalCount, recent] = await Promise.all([
    db.select({ count: sql<number>`count(*)` }).from(redemption).where(and(eq(redemption.outletId, outletId), gte(redemption.createdAt, today))),
    db.select({ count: sql<number>`count(*)` }).from(redemption).where(and(eq(redemption.outletId, outletId), gte(redemption.createdAt, weekAgo))),
    db.select({ count: sql<number>`count(*)` }).from(redemption).where(eq(redemption.outletId, outletId)),
    db.select({
      id: redemption.id, status: redemption.status, redeemedAt: redemption.redeemedAt,
      createdAt: redemption.createdAt, memberName: user.name,
    }).from(redemption).leftJoin(user, eq(redemption.accountId, user.id))
      .where(eq(redemption.outletId, outletId)).orderBy(desc(redemption.createdAt)).limit(10),
  ]);

  return success(c, {
    todayScans: Number(todayCount[0]?.count || 0),
    weekScans: Number(weekCount[0]?.count || 0),
    totalRedemptions: Number(totalCount[0]?.count || 0),
    recentRedemptions: recent,
  });
});

// GET /merchant/outlet/:id
merchantRoutes.get("/outlet/:id", async (c) => {
  const id = c.req.param("id")!;
  const userRoles = c.get("userRoles") as UserVars["userRoles"];

  const hasAccess = userRoles.some((r) => r.outletId === id);
  if (!hasAccess) {
    return error(c, "FORBIDDEN", "You don't have access to this outlet", 403);
  }

  const [out] = await db.select().from(outlet).where(eq(outlet.id, id)).limit(1);
  if (!out) {
    return error(c, "NOT_FOUND", "Outlet not found", 404);
  }

  return success(c, out);
});

// PUT /merchant/outlet/:id — owner or manager only
merchantRoutes.put("/outlet/:id", requireRole("owner", "manager"), async (c) => {
  const id = c.req.param("id")!;
  const userRoles = c.get("userRoles") as UserVars["userRoles"];

  const hasAccess = userRoles.some((r) => r.outletId === id && (r.role === "owner" || r.role === "manager"));
  if (!hasAccess) {
    return error(c, "FORBIDDEN", "Owner or manager role required", 403);
  }

  const body = await c.req.json();
  const allowedFields = ["label", "address", "lat", "lng", "operatingHours", "isOpen", "bogoLimit", "whatsappNumber", "phoneContact", "instagramHandle", "status"];
  const updates: Record<string, unknown> = {};
  for (const field of allowedFields) {
    if (body[field] !== undefined) updates[field] = body[field];
  }
  if (Object.keys(updates).length === 0) {
    return error(c, "VALIDATION_ERROR", "No valid fields to update", 400);
  }

  const [updated] = await db.update(outlet).set(updates).where(eq(outlet.id, id)).returning();
  return success(c, updated);
});

// GET /merchant/restaurant/:id — owner only
merchantRoutes.get("/restaurant/:id", requireRole("owner"), async (c) => {
  const id = c.req.param("id")!;
  const userRoles = c.get("userRoles") as UserVars["userRoles"];

  const outlets = await db.select({ id: outlet.id }).from(outlet).where(eq(outlet.restaurantId, id));
  const ownsOutlet = outlets.some((o) => userRoles.some((r) => r.outletId === o.id && r.role === "owner"));
  if (!ownsOutlet) {
    return error(c, "FORBIDDEN", "You don't own this restaurant", 403);
  }

  const [rest] = await db.select().from(restaurant).where(eq(restaurant.id, id)).limit(1);
  if (!rest) {
    return error(c, "NOT_FOUND", "Restaurant not found", 404);
  }

  return success(c, rest);
});

// PUT /merchant/restaurant/:id — owner only
merchantRoutes.put("/restaurant/:id", requireRole("owner"), async (c) => {
  const id = c.req.param("id")!;
  const userRoles = c.get("userRoles") as UserVars["userRoles"];

  const outlets = await db.select({ id: outlet.id }).from(outlet).where(eq(outlet.restaurantId, id));
  const ownsOutlet = outlets.some((o) => userRoles.some((r) => r.outletId === o.id && r.role === "owner"));
  if (!ownsOutlet) {
    return error(c, "FORBIDDEN", "You don't own this restaurant", 403);
  }

  const body = await c.req.json();
  const allowedFields = ["name", "description", "cuisineTags", "halalCertified", "logo"];
  const updates: Record<string, unknown> = {};
  for (const field of allowedFields) {
    if (body[field] !== undefined) updates[field] = body[field];
  }
  if (Object.keys(updates).length === 0) {
    return error(c, "VALIDATION_ERROR", "No valid fields to update", 400);
  }

  const [updated] = await db.update(restaurant).set(updates).where(eq(restaurant.id, id)).returning();
  return success(c, updated);
});

export { merchantRoutes };
