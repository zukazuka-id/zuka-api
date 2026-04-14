import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { db } from "../db/index.js";
import { restaurant, outlet, redemption, user, restaurantPhoto } from "../db/schema.js";
import { eq, and, gte, sql, desc, isNull, asc } from "drizzle-orm";
import { requireRole } from "../middleware/auth.js";
import { success, error } from "../lib/response.js";
import { updateOutletSchema, updateRestaurantSchema } from "../validators/index.js";

type UserVars = {
  user: { id: string; name: string; email: string; [key: string]: unknown };
  session: { id: string; token: string; [key: string]: unknown };
  userRoles: { role: string; outletId: string }[];
};

const merchantRoutes = new Hono<{ Variables: UserVars }>();

type MerchantOutletContext = {
  outletId: string;
  outletStatus: string | null;
  restaurantId: string;
  restaurantStatus: string | null;
};

function isMerchantContextArchived(context: MerchantOutletContext): boolean {
  return context.outletStatus === "archived" || context.restaurantStatus === "archived";
}

function isMerchantContextReadOnly(context: MerchantOutletContext): boolean {
  return context.outletStatus === "suspended" || context.restaurantStatus === "suspended";
}

async function loadMerchantOutletContext(outletId: string): Promise<MerchantOutletContext | null> {
  const [context] = await db
    .select({
      outletId: outlet.id,
      outletStatus: outlet.status,
      restaurantId: restaurant.id,
      restaurantStatus: restaurant.status,
    })
    .from(outlet)
    .innerJoin(restaurant, eq(restaurant.id, outlet.restaurantId))
    .where(eq(outlet.id, outletId))
    .limit(1);

  return context ?? null;
}

async function loadMerchantRestaurantContexts(restaurantId: string): Promise<MerchantOutletContext[]> {
  return db
    .select({
      outletId: outlet.id,
      outletStatus: outlet.status,
      restaurantId: restaurant.id,
      restaurantStatus: restaurant.status,
    })
    .from(outlet)
    .innerJoin(restaurant, eq(restaurant.id, outlet.restaurantId))
    .where(eq(restaurant.id, restaurantId));
}

async function loadMerchantRestaurantStatus(restaurantId: string): Promise<string | null> {
  const [row] = await db
    .select({ status: restaurant.status })
    .from(restaurant)
    .where(eq(restaurant.id, restaurantId))
    .limit(1);

  return row?.status ?? null;
}

// All merchant routes require at least staff role
merchantRoutes.use("*", requireRole("owner", "manager", "staff"));

// GET /merchant/dashboard
merchantRoutes.get("/dashboard", async (c) => {
  const userRoles = c.get("userRoles") as UserVars["userRoles"];
  const outletId = c.req.query("outletId") || userRoles[0]?.outletId;

  if (!outletId) {
    return error(c, "VALIDATION_ERROR", "outletId is required", 400);
  }

  const context = await loadMerchantOutletContext(outletId);
  if (!context || isMerchantContextArchived(context)) {
    return error(c, "NOT_FOUND", "Outlet not found", 404);
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

  const context = await loadMerchantOutletContext(id);
  if (!context || isMerchantContextArchived(context)) {
    return error(c, "NOT_FOUND", "Outlet not found", 404);
  }

  const [out] = await db.select().from(outlet).where(eq(outlet.id, id)).limit(1);
  if (!out) {
    return error(c, "NOT_FOUND", "Outlet not found", 404);
  }

  const photos = await db
    .select({
      id: restaurantPhoto.id,
      url: restaurantPhoto.url,
      label: restaurantPhoto.label,
    })
    .from(restaurantPhoto)
    .where(and(eq(restaurantPhoto.outletId, id), isNull(restaurantPhoto.restaurantId)))
    .orderBy(asc(restaurantPhoto.sortOrder), asc(restaurantPhoto.createdAt));

  return success(c, { ...out, photos });
});

// PUT /merchant/outlet/:id — owner or manager only
merchantRoutes.put("/outlet/:id", zValidator("json", updateOutletSchema), async (c) => {
  const id = c.req.param("id")!;
  const userRoles = c.get("userRoles") as UserVars["userRoles"];

  const hasAccess = userRoles.some((r) => r.outletId === id && (r.role === "owner" || r.role === "manager"));
  if (!hasAccess) {
    return error(c, "FORBIDDEN", "Owner or manager role required", 403);
  }

  const context = await loadMerchantOutletContext(id);
  if (!context || isMerchantContextArchived(context)) {
    return error(c, "NOT_FOUND", "Outlet not found", 404);
  }
  if (isMerchantContextReadOnly(context)) {
    return error(c, "FORBIDDEN", "Suspended outlet context is read-only", 403);
  }

  const updates = c.req.valid("json");
  if ("status" in updates) {
    return error(c, "FORBIDDEN", "Merchant cannot change outlet lifecycle status", 403);
  }
  if (Object.keys(updates).length === 0) {
    return error(c, "VALIDATION_ERROR", "No valid fields to update", 400);
  }

  const [updated] = await db.update(outlet).set(updates).where(eq(outlet.id, id)).returning();
  return success(c, updated);
});

// GET /merchant/restaurant/:id — owner only
merchantRoutes.get("/restaurant/:id", async (c) => {
  const id = c.req.param("id")!;
  const userRoles = c.get("userRoles") as UserVars["userRoles"];

  const isOwner = userRoles.some((r) => r.role === "owner");
  if (!isOwner) {
    return error(c, "FORBIDDEN", "Owner role required", 403);
  }

  const contexts = await loadMerchantRestaurantContexts(id);
  const ownsOutlet = contexts.some((o) => userRoles.some((r) => r.outletId === o.outletId && r.role === "owner"));
  if (!ownsOutlet) {
    return error(c, "FORBIDDEN", "You don't own this restaurant", 403);
  }
  const restaurantStatus = await loadMerchantRestaurantStatus(id);
  if (!restaurantStatus || restaurantStatus === "archived") {
    return error(c, "NOT_FOUND", "Restaurant not found", 404);
  }

  const [rest] = await db.select().from(restaurant).where(eq(restaurant.id, id)).limit(1);
  if (!rest) {
    return error(c, "NOT_FOUND", "Restaurant not found", 404);
  }

  return success(c, rest);
});

// PUT /merchant/restaurant/:id — owner only
merchantRoutes.put("/restaurant/:id", zValidator("json", updateRestaurantSchema), async (c) => {
  const id = c.req.param("id")!;
  const userRoles = c.get("userRoles") as UserVars["userRoles"];

  const contexts = await loadMerchantRestaurantContexts(id);
  const ownsOutlet = contexts.some((o) => userRoles.some((r) => r.outletId === o.outletId && r.role === "owner"));
  if (!ownsOutlet) {
    return error(c, "FORBIDDEN", "You don't own this restaurant", 403);
  }
  const restaurantStatus = await loadMerchantRestaurantStatus(id);
  if (!restaurantStatus || restaurantStatus === "archived") {
    return error(c, "NOT_FOUND", "Restaurant not found", 404);
  }
  if (restaurantStatus === "suspended") {
    return error(c, "FORBIDDEN", "Suspended restaurant context is read-only", 403);
  }

  const updates = c.req.valid("json");
  if (Object.keys(updates).length === 0) {
    return error(c, "VALIDATION_ERROR", "No valid fields to update", 400);
  }

  const [updated] = await db.update(restaurant).set(updates).where(eq(restaurant.id, id)).returning();
  return success(c, updated);
});

export { merchantRoutes };
