import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { requireAdmin } from "../middleware/admin.js";
import { db } from "../db/index.js";
import { success, error } from "../lib/response.js";
import { getImageKitUploadAuth } from "../lib/imagekit.js";
import { computeOutletIsOpen, getNextOpenTime, shouldClearManualClose } from "../lib/outlet-availability.js";
import {
  replaceOutletPhotos,
  replaceRestaurantPhotos,
  withRestaurantPhotoTransaction,
} from "../lib/restaurant-photos.js";
import {
  adminCreateInvitesSchema,
  adminCreateOutletSchema,
  adminCreateRestaurantSchema,
  adminManualCloseOutletSchema,
  adminMembersQuerySchema,
  adminRestaurantsQuerySchema,
  adminRedemptionsQuerySchema,
  adminInvitesQuerySchema,
  adminConfigUpsertSchema,
  adminUpdateOutletSchema,
  adminUpdateRestaurantSchema,
  createBannerSchema,
  updateBannerSchema,
  bannerListQuerySchema,
  createCuratedListSchema,
  updateCuratedListSchema,
  curatedListQuerySchema,
  addRestaurantToListSchema,
} from "../validators/index.js";
import {
  user,
  session,
  subscription,
  redemption,
  invite,
  outlet,
  restaurant,
  restaurantPhoto,
  accountRole,
  platformConfig,
} from "../db/schema.js";
import { eq, sql, and, desc, ilike, like, gte, lte, count, isNull, asc } from "drizzle-orm";
import {
  getActiveBanners,
  getAllBanners,
  createBanner,
  updateBanner,
  deleteBanner,
} from "../lib/banner-service.js";
import {
  getAllCuratedLists,
  createCuratedList,
  updateCuratedList,
  deleteCuratedList,
  addRestaurantToList,
  removeRestaurantFromList,
} from "../lib/curated-list-service.js";

const adminRoutes = new Hono();

type RestaurantLifecycleMutationResult =
  | { kind: "not_found" }
  | { kind: "archived_locked" }
  | { kind: "ok"; restaurant: typeof restaurant.$inferSelect };

async function updateRestaurantLifecycleStatus(
  restaurantId: string,
  nextStatus: "active" | "suspended" | "archived"
) : Promise<RestaurantLifecycleMutationResult> {
  return db.transaction(async (tx) => {
    const [existingRestaurant] = await tx
      .select({ id: restaurant.id, status: restaurant.status })
      .from(restaurant)
      .where(eq(restaurant.id, restaurantId))
      .limit(1);

    if (!existingRestaurant) {
      return { kind: "not_found" };
    }

    if (existingRestaurant.status === "archived") {
      return { kind: "archived_locked" };
    }

    const [updatedRestaurant] = await tx
      .update(restaurant)
      .set({ status: nextStatus })
      .where(eq(restaurant.id, restaurantId))
      .returning();

    if (nextStatus === "active") {
      const childOutlets = await tx
        .select({
          id: outlet.id,
          status: outlet.status,
          operatingHours: outlet.operatingHours,
          isManuallyClosed: outlet.isManuallyClosed,
          manualCloseReopenStrategy: outlet.manualCloseReopenStrategy,
          manualCloseReopenAt: outlet.manualCloseReopenAt,
        })
        .from(outlet)
        .where(eq(outlet.restaurantId, restaurantId));

      for (const childOutlet of childOutlets) {
        const availabilityInput = {
          outlet: {
            status: childOutlet.status,
            operatingHours: (childOutlet.operatingHours as Record<string, unknown> | null | undefined) ?? null,
            isManuallyClosed: childOutlet.isManuallyClosed,
            manualCloseReopenStrategy: childOutlet.manualCloseReopenStrategy as "next_hours" | "custom" | "indefinite" | null,
            manualCloseReopenAt: childOutlet.manualCloseReopenAt,
          },
          restaurant: {
            status: nextStatus,
          },
          now: new Date(),
        };

        const updates: Record<string, unknown> = {
          isOpen: computeOutletIsOpen(availabilityInput),
        };

        if (shouldClearManualClose(availabilityInput)) {
          updates.isManuallyClosed = false;
          updates.manualCloseReopenStrategy = "indefinite";
          updates.manualCloseReopenAt = null;
        }

        await tx.update(outlet).set(updates).where(eq(outlet.id, childOutlet.id));
      }
    } else {
      await tx
        .update(outlet)
        .set({ isOpen: false })
        .where(eq(outlet.restaurantId, restaurantId));
    }

    if (!updatedRestaurant) {
      return { kind: "not_found" };
    }

    return { kind: "ok", restaurant: updatedRestaurant };
  });
}

// ─── A1: Members ────────────────────────────────────────────

adminRoutes.get("/imagekit/upload-auth", requireAdmin, async (c) => {
  try {
    return success(c, getImageKitUploadAuth());
  } catch (err) {
    return error(
      c,
      "IMAGEKIT_CONFIG_MISSING",
      err instanceof Error ? err.message : "ImageKit upload auth is not configured",
      500
    );
  }
});

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
  const {
    search,
    restaurantStatus,
    outletStatus,
    isOpen,
    cuisine,
    halal,
    includeArchived,
    status,
    halalCertified,
    page,
    limit,
  } = c.req.valid("query");
  const offset = (page - 1) * limit;
  const resolvedRestaurantStatus = restaurantStatus ?? status;
  const resolvedHalal = halal ?? halalCertified;

  const conditions = [];
  if (search) {
    conditions.push(ilike(restaurant.name, `%${search}%`));
  }
  if (resolvedRestaurantStatus) {
    conditions.push(eq(restaurant.status, resolvedRestaurantStatus));
  } else if (!includeArchived) {
    conditions.push(sql`${restaurant.status} <> 'archived'`);
  }
  if (resolvedHalal !== undefined) {
    conditions.push(eq(restaurant.halalCertified, resolvedHalal));
  }
  if (cuisine) {
    conditions.push(sql`${restaurant.cuisineTags} @> ARRAY[${cuisine}]`);
  }
  if (outletStatus) {
    conditions.push(eq(outlet.status, outletStatus));
  }
  if (isOpen !== undefined) {
    conditions.push(eq(outlet.isOpen, isOpen));
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
      status: restaurant.status,
      operatingHours: restaurant.operatingHours,
      defaultBogoLimit: restaurant.defaultBogoLimit,
      defaultAvgTableSpend: restaurant.defaultAvgTableSpend,
      whatsappNumber: restaurant.whatsappNumber,
      phoneNumber: restaurant.phoneNumber,
      instagramHandle: restaurant.instagramHandle,
      tiktokHandle: restaurant.tiktokHandle,
      facebookUrl: restaurant.facebookUrl,
      createdAt: restaurant.createdAt,
      updatedAt: restaurant.updatedAt,
      outletCount: sql<number>`(
        select count(*)::int
        from ${outlet} as total_outlets
        where total_outlets.restaurant_id = ${restaurant.id}
      )`,
    })
      .from(restaurant)
      .leftJoin(outlet, eq(outlet.restaurantId, restaurant.id))
      .where(where)
      .groupBy(restaurant.id)
      .orderBy(desc(restaurant.createdAt))
      .limit(limit)
      .offset(offset),
    db.select({ count: sql<number>`count(distinct ${restaurant.id})::int` })
      .from(restaurant)
      .leftJoin(outlet, eq(outlet.restaurantId, restaurant.id))
      .where(where),
  ]);

  return success(c, { restaurants, total: totalResult[0]?.count ?? 0, page, limit });
});

adminRoutes.post("/restaurants", requireAdmin, zValidator("json", adminCreateRestaurantSchema), async (c) => {
  const payload = c.req.valid("json");
  const { photos = [], ...rest } = payload;

  const values: typeof restaurant.$inferInsert = {
    name: rest.name,
    description: rest.description,
    cuisineTags: rest.cuisineTags,
    halalCertified: rest.halalCertified,
    operatingHours: rest.operatingHours,
    whatsappNumber: rest.whatsappNumber,
    phoneNumber: rest.phoneNumber,
    instagramHandle: rest.instagramHandle,
    tiktokHandle: rest.tiktokHandle,
    facebookUrl: rest.facebookUrl,
    defaultBogoLimit: rest.defaultBogoLimit,
    defaultAvgTableSpend: rest.defaultAvgTableSpend,
    status: "pending",
  };

  const created = await withRestaurantPhotoTransaction(db, async (tx) => {
    const [inserted] = await tx.insert(restaurant).values(values).returning();
    await replaceRestaurantPhotos(tx, inserted.id, photos);
    return inserted;
  });

  return success(c, created, 201);
});

adminRoutes.get("/restaurants/cuisine-tags", requireAdmin, async (c) => {
  const rows = await db
    .select({ cuisineTags: restaurant.cuisineTags })
    .from(restaurant)
    .where(sql`${restaurant.cuisineTags} is not null`);

  const tags = Array.from(
    new Set(rows.flatMap((row) => row.cuisineTags ?? []))
  ).sort((a, b) => a.localeCompare(b));

  return success(c, { tags });
});

adminRoutes.put("/restaurants/:id", requireAdmin, zValidator("json", adminUpdateRestaurantSchema), async (c) => {
  const { id } = c.req.param();
  const payload = c.req.valid("json");
  const { photos, ...rest } = payload;

  const [existingRestaurant] = await db
    .select({ status: restaurant.status })
    .from(restaurant)
    .where(eq(restaurant.id, id))
    .limit(1);

  if (!existingRestaurant) {
    return error(c, "NOT_FOUND", "Restaurant not found", 404);
  }

  if (existingRestaurant.status === "archived") {
    return error(c, "FORBIDDEN", "Archived restaurants are read-only", 403);
  }

  const updates = Object.fromEntries(
    Object.entries(rest).filter(([, value]) => value !== undefined)
  );

  if (Object.keys(updates).length === 0 && photos === undefined) {
    return error(c, "VALIDATION_ERROR", "No valid fields to update", 400);
  }

  const updated = await withRestaurantPhotoTransaction(db, async (tx) => {
    let nextRestaurant = null;

    if (Object.keys(updates).length > 0) {
      const [row] = await tx
        .update(restaurant)
        .set(updates)
        .where(eq(restaurant.id, id))
        .returning();
      nextRestaurant = row ?? null;
    } else {
      const [row] = await tx.select().from(restaurant).where(eq(restaurant.id, id)).limit(1);
      nextRestaurant = row ?? null;
    }

    if (!nextRestaurant) {
      return null;
    }

    if (photos !== undefined) {
      await replaceRestaurantPhotos(tx, nextRestaurant.id, photos);
    }

    return nextRestaurant;
  });

  if (!updated) {
    return error(c, "NOT_FOUND", "Restaurant not found", 404);
  }

  return success(c, updated);
});

adminRoutes.get("/restaurants/:id", requireAdmin, async (c) => {
  const { id } = c.req.param();

  const [rest] = await db.select().from(restaurant).where(eq(restaurant.id, id)).limit(1);
  if (!rest) return error(c, "NOT_FOUND", "Restaurant not found", 404);

  const [outlets, photos] = await Promise.all([
    db.select().from(outlet).where(eq(outlet.restaurantId, id)),
    db.select()
      .from(restaurantPhoto)
      .where(and(eq(restaurantPhoto.restaurantId, id), isNull(restaurantPhoto.outletId)))
      .orderBy(asc(restaurantPhoto.sortOrder), asc(restaurantPhoto.createdAt)),
  ]);

  return success(c, { ...rest, photos, outlets });
});

adminRoutes.post("/restaurants/:id/activate", requireAdmin, async (c) => {
  const { id } = c.req.param();
  const result = await updateRestaurantLifecycleStatus(id, "active");

  if (result.kind === "not_found") {
    return error(c, "NOT_FOUND", "Restaurant not found", 404);
  }

  if (result.kind === "archived_locked") {
    return error(c, "FORBIDDEN", "Archived restaurants are read-only", 403);
  }

  return success(c, result.restaurant);
});

adminRoutes.post("/restaurants/:id/suspend", requireAdmin, async (c) => {
  const { id } = c.req.param();
  const result = await updateRestaurantLifecycleStatus(id, "suspended");

  if (result.kind === "not_found") {
    return error(c, "NOT_FOUND", "Restaurant not found", 404);
  }

  if (result.kind === "archived_locked") {
    return error(c, "FORBIDDEN", "Archived restaurants are read-only", 403);
  }

  return success(c, result.restaurant);
});

adminRoutes.post("/restaurants/:id/archive", requireAdmin, async (c) => {
  const { id } = c.req.param();
  const result = await updateRestaurantLifecycleStatus(id, "archived");

  if (result.kind === "not_found") {
    return error(c, "NOT_FOUND", "Restaurant not found", 404);
  }

  if (result.kind === "archived_locked") {
    return error(c, "FORBIDDEN", "Archived restaurants are read-only", 403);
  }

  return success(c, result.restaurant);
});

adminRoutes.post("/restaurants/:restaurantId/outlets", requireAdmin, zValidator("json", adminCreateOutletSchema), async (c) => {
  const { restaurantId } = c.req.param();
  const payload = c.req.valid("json");
  const { photos = [], ...rest } = payload;

  const [parentRestaurant] = await db
    .select()
    .from(restaurant)
    .where(eq(restaurant.id, restaurantId))
    .limit(1);

  if (!parentRestaurant) {
    return error(c, "NOT_FOUND", "Restaurant not found", 404);
  }

  if (parentRestaurant.status === "archived") {
    return error(c, "FORBIDDEN", "Archived restaurants are read-only", 403);
  }

  const nextStatus = rest.status ?? "pending";
  const nextIsOpen = nextStatus === "active" && parentRestaurant.status === "active"
    ? (rest.isOpen ?? true)
    : false;

  const values: typeof outlet.$inferInsert = {
    restaurantId,
    label: rest.label,
    address: rest.address,
    lat: rest.lat,
    lng: rest.lng,
    operatingHours: rest.operatingHours ?? parentRestaurant.operatingHours,
    isOpen: nextIsOpen,
    bogoLimit: rest.bogoLimit ?? parentRestaurant.defaultBogoLimit,
    avgTableSpend: rest.avgTableSpend ?? parentRestaurant.defaultAvgTableSpend,
    whatsappNumber: rest.whatsappNumber,
    phoneContact: rest.phoneContact,
    instagramHandle: rest.instagramHandle,
    status: nextStatus,
  };

  const created = await withRestaurantPhotoTransaction(db, async (tx) => {
    const [inserted] = await tx.insert(outlet).values(values).returning();
    await replaceOutletPhotos(tx, inserted.id, photos);
    return inserted;
  });

  return success(c, created, 201);
});

adminRoutes.get("/outlets/:outletId", requireAdmin, async (c) => {
  const { outletId } = c.req.param();

  const [record] = await db.select().from(outlet).where(eq(outlet.id, outletId)).limit(1);
  if (!record) {
    return error(c, "NOT_FOUND", "Outlet not found", 404);
  }

  const photos = await db
    .select()
    .from(restaurantPhoto)
    .where(and(eq(restaurantPhoto.outletId, outletId), isNull(restaurantPhoto.restaurantId)))
    .orderBy(asc(restaurantPhoto.sortOrder), asc(restaurantPhoto.createdAt));

  return success(c, { ...record, photos });
});

adminRoutes.put("/outlets/:outletId", requireAdmin, zValidator("json", adminUpdateOutletSchema), async (c) => {
  const { outletId } = c.req.param();
  const payload = c.req.valid("json");
  const { photos, ...rest } = payload;

  const [existingContext] = await db
    .select({
      outletStatus: outlet.status,
      restaurantStatus: restaurant.status,
    })
    .from(outlet)
    .innerJoin(restaurant, eq(restaurant.id, outlet.restaurantId))
    .where(eq(outlet.id, outletId))
    .limit(1);

  if (!existingContext) {
    return error(c, "NOT_FOUND", "Outlet not found", 404);
  }

  if (existingContext.outletStatus === "archived" || existingContext.restaurantStatus === "archived") {
    return error(c, "FORBIDDEN", "Archived outlet context is read-only", 403);
  }

  const updates = Object.fromEntries(
    Object.entries(rest).filter(([, value]) => value !== undefined)
  );

  if (Object.keys(updates).length === 0 && photos === undefined) {
    return error(c, "VALIDATION_ERROR", "No valid fields to update", 400);
  }

  if ("status" in updates || "isOpen" in updates) {
    const [existingOutlet] = await db
      .select({
        status: outlet.status,
        restaurantStatus: restaurant.status,
      })
      .from(outlet)
      .innerJoin(restaurant, eq(restaurant.id, outlet.restaurantId))
      .where(eq(outlet.id, outletId))
      .limit(1);

    if (!existingOutlet) {
      return error(c, "NOT_FOUND", "Outlet not found", 404);
    }

    const nextStatus = updates.status ?? existingOutlet.status;
    if (nextStatus !== "active" || existingOutlet.restaurantStatus !== "active") {
      updates.isOpen = false;
    }
  }

  const updated = await withRestaurantPhotoTransaction(db, async (tx) => {
    let nextOutlet = null;

    if (Object.keys(updates).length > 0) {
      const [row] = await tx
        .update(outlet)
        .set(updates)
        .where(eq(outlet.id, outletId))
        .returning();
      nextOutlet = row ?? null;
    } else {
      const [row] = await tx.select().from(outlet).where(eq(outlet.id, outletId)).limit(1);
      nextOutlet = row ?? null;
    }

    if (!nextOutlet) {
      return null;
    }

    if (photos !== undefined) {
      await replaceOutletPhotos(tx, nextOutlet.id, photos);
    }

    return nextOutlet;
  });

  if (!updated) {
    return error(c, "NOT_FOUND", "Outlet not found", 404);
  }

  return success(c, updated);
});

adminRoutes.post("/outlets/:outletId/activate", requireAdmin, async (c) => {
  const { outletId } = c.req.param();

  const [existingOutlet] = await db
    .select({
      outletStatus: outlet.status,
      restaurantStatus: restaurant.status,
    })
    .from(outlet)
    .innerJoin(restaurant, eq(restaurant.id, outlet.restaurantId))
    .where(eq(outlet.id, outletId))
    .limit(1);

  if (!existingOutlet) {
    return error(c, "NOT_FOUND", "Outlet not found", 404);
  }

  if (existingOutlet.outletStatus === "archived" || existingOutlet.restaurantStatus === "archived") {
    return error(c, "FORBIDDEN", "Archived outlet context is read-only", 403);
  }

  const [updated] = await db
    .update(outlet)
    .set({ status: "active", isOpen: existingOutlet.restaurantStatus === "active" })
    .where(eq(outlet.id, outletId))
    .returning();

  return success(c, updated);
});

adminRoutes.post("/outlets/:outletId/suspend", requireAdmin, async (c) => {
  const { outletId } = c.req.param();

  const [existingOutlet] = await db
    .select({
      outletStatus: outlet.status,
      restaurantStatus: restaurant.status,
    })
    .from(outlet)
    .innerJoin(restaurant, eq(restaurant.id, outlet.restaurantId))
    .where(eq(outlet.id, outletId))
    .limit(1);

  if (!existingOutlet) {
    return error(c, "NOT_FOUND", "Outlet not found", 404);
  }

  if (existingOutlet.outletStatus === "archived" || existingOutlet.restaurantStatus === "archived") {
    return error(c, "FORBIDDEN", "Archived outlet context is read-only", 403);
  }

  const [updated] = await db
    .update(outlet)
    .set({ status: "suspended", isOpen: false })
    .where(eq(outlet.id, outletId))
    .returning();

  if (!updated) {
    return error(c, "NOT_FOUND", "Outlet not found", 404);
  }

  return success(c, updated);
});

adminRoutes.post("/outlets/:outletId/archive", requireAdmin, async (c) => {
  const { outletId } = c.req.param();

  const [existingOutlet] = await db
    .select({
      outletStatus: outlet.status,
      restaurantStatus: restaurant.status,
    })
    .from(outlet)
    .innerJoin(restaurant, eq(restaurant.id, outlet.restaurantId))
    .where(eq(outlet.id, outletId))
    .limit(1);

  if (!existingOutlet) {
    return error(c, "NOT_FOUND", "Outlet not found", 404);
  }

  if (existingOutlet.outletStatus === "archived" || existingOutlet.restaurantStatus === "archived") {
    return error(c, "FORBIDDEN", "Archived outlet context is read-only", 403);
  }

  const [updated] = await db
    .update(outlet)
    .set({ status: "archived", isOpen: false })
    .where(eq(outlet.id, outletId))
    .returning();

  if (!updated) {
    return error(c, "NOT_FOUND", "Outlet not found", 404);
  }

  return success(c, updated);
});

adminRoutes.post("/outlets/:outletId/close", requireAdmin, zValidator("json", adminManualCloseOutletSchema), async (c) => {
  const { outletId } = c.req.param();
  const { reopenStrategy, customReopenAt } = c.req.valid("json");

  const [existingOutlet] = await db
    .select({
      id: outlet.id,
      operatingHours: outlet.operatingHours,
      outletStatus: outlet.status,
      restaurantStatus: restaurant.status,
    })
    .from(outlet)
    .innerJoin(restaurant, eq(restaurant.id, outlet.restaurantId))
    .where(eq(outlet.id, outletId))
    .limit(1);

  if (!existingOutlet) {
    return error(c, "NOT_FOUND", "Outlet not found", 404);
  }

  if (existingOutlet.outletStatus === "archived" || existingOutlet.restaurantStatus === "archived") {
    return error(c, "FORBIDDEN", "Archived outlet context is read-only", 403);
  }

  const computedReopenAt = reopenStrategy === "custom"
    ? new Date(customReopenAt!)
    : reopenStrategy === "next_hours"
      ? getNextOpenTime((existingOutlet.operatingHours as Record<string, unknown> | null | undefined) ?? null)
      : null;

  const [updated] = await db
    .update(outlet)
    .set({
      isManuallyClosed: true,
      manualCloseReopenStrategy: reopenStrategy,
      manualCloseReopenAt: computedReopenAt,
      isOpen: false,
    })
    .where(eq(outlet.id, outletId))
    .returning();

  return success(c, updated);
});

adminRoutes.post("/outlets/:outletId/open", requireAdmin, async (c) => {
  const { outletId } = c.req.param();

  const [existingOutlet] = await db
    .select({
      status: outlet.status,
      operatingHours: outlet.operatingHours,
      outletStatus: outlet.status,
      restaurantStatus: restaurant.status,
    })
    .from(outlet)
    .innerJoin(restaurant, eq(restaurant.id, outlet.restaurantId))
    .where(eq(outlet.id, outletId))
    .limit(1);

  if (!existingOutlet) {
    return error(c, "NOT_FOUND", "Outlet not found", 404);
  }

  if (existingOutlet.outletStatus === "archived" || existingOutlet.restaurantStatus === "archived") {
    return error(c, "FORBIDDEN", "Archived outlet context is read-only", 403);
  }

  const [updated] = await db
    .update(outlet)
    .set({
      isManuallyClosed: false,
      manualCloseReopenStrategy: "indefinite",
      manualCloseReopenAt: null,
      isOpen: computeOutletIsOpen({
        outlet: {
          status: existingOutlet.status,
          operatingHours: (existingOutlet.operatingHours as Record<string, unknown> | null | undefined) ?? null,
          isManuallyClosed: false,
          manualCloseReopenStrategy: "indefinite",
          manualCloseReopenAt: null,
        },
        restaurant: {
          status: existingOutlet.restaurantStatus,
        },
        now: new Date(),
      }),
    })
    .where(eq(outlet.id, outletId))
    .returning();

  return success(c, updated);
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

// ─── A6: Platform Config ──────────────────────────────────────

adminRoutes.get("/config", requireAdmin, async (c) => {
  const rows = await db.select().from(platformConfig).orderBy(platformConfig.key);
  return success(c, rows);
});

adminRoutes.put(
  "/config",
  requireAdmin,
  zValidator("json", adminConfigUpsertSchema),
  async (c) => {
    const { key, value, isPublic } = c.req.valid("json");
    const admin = c.get("admin") as { id: string; [key: string]: unknown };
    await db
      .insert(platformConfig)
      .values({ key, value, isPublic: isPublic ?? false, updatedBy: admin.id })
      .onConflictDoUpdate({
        target: platformConfig.key,
        set: {
          value,
          ...(isPublic !== undefined ? { isPublic } : {}),
          updatedAt: new Date(),
          updatedBy: admin.id,
        },
      });
    return success(c, { key, value, isPublic });
  },
);

adminRoutes.delete("/config/:key", requireAdmin, async (c) => {
  const key = c.req.param("key");
  const [existing] = await db
    .select()
    .from(platformConfig)
    .where(eq(platformConfig.key, key))
    .limit(1);
  if (!existing) {
    return error(c, "NOT_FOUND", "Config key not found", 404);
  }
  await db.delete(platformConfig).where(eq(platformConfig.key, key));
  return success(c, { deleted: true });
});

// ─── Cron: Keep Warm ─────────────────────────────────────────────────────
// Prevents cold starts by pingging every 4 minutes via Vercel Cron
// No auth required - only responds to Vercel's cron requests
adminRoutes.get("/cron/keep-warm", async (c) => {
  const authHeader = c.req.header("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return error(c, "UNAUTHORIZED", "Invalid cron signature", 401);
  }
  return success(c, { warmed: true, timestamp: new Date().toISOString() });
});

// ─── Banners ──────────────────────────────────────────────────────────────

adminRoutes.get("/banners", requireAdmin, zValidator("query", bannerListQuerySchema), async (c) => {
  const { includeInactive } = c.req.valid("query");
  const banners = await getAllBanners(includeInactive);
  return success(c, banners);
});

adminRoutes.post("/banners", requireAdmin, zValidator("json", createBannerSchema), async (c) => {
  const data = c.req.valid("json");
  const created = await createBanner(data);
  return success(c, created, 201);
});

adminRoutes.patch("/banners/:id", requireAdmin, zValidator("json", updateBannerSchema), async (c) => {
  const { id } = c.req.param();
  const data = c.req.valid("json");
  const updated = await updateBanner(id, data);
  if (!updated) return error(c, "NOT_FOUND", "Banner not found", 404);
  return success(c, updated);
});

adminRoutes.delete("/banners/:id", requireAdmin, async (c) => {
  const { id } = c.req.param();
  const deleted = await deleteBanner(id);
  if (!deleted) return error(c, "NOT_FOUND", "Banner not found", 404);
  return success(c, { deleted: true });
});

// ─── Curated Lists ────────────────────────────────────────────────────────

adminRoutes.get("/curated-lists", requireAdmin, zValidator("query", curatedListQuerySchema), async (c) => {
  const { includeInactive } = c.req.valid("query");
  const lists = await getAllCuratedLists(includeInactive);
  return success(c, lists);
});

adminRoutes.post("/curated-lists", requireAdmin, zValidator("json", createCuratedListSchema), async (c) => {
  const data = c.req.valid("json");
  const created = await createCuratedList(data);
  return success(c, created, 201);
});

adminRoutes.patch("/curated-lists/:id", requireAdmin, zValidator("json", updateCuratedListSchema), async (c) => {
  const { id } = c.req.param();
  const data = c.req.valid("json");
  const updated = await updateCuratedList(id, data);
  if (!updated) return error(c, "NOT_FOUND", "Curated list not found", 404);
  return success(c, updated);
});

adminRoutes.delete("/curated-lists/:id", requireAdmin, async (c) => {
  const { id } = c.req.param();
  const deleted = await deleteCuratedList(id);
  if (!deleted) return error(c, "NOT_FOUND", "Curated list not found", 404);
  return success(c, { deleted: true });
});

adminRoutes.post(
  "/curated-lists/:id/restaurants",
  requireAdmin,
  zValidator("json", addRestaurantToListSchema),
  async (c) => {
    const { id } = c.req.param();
    const { restaurantId, sortOrder } = c.req.valid("json");
    const added = await addRestaurantToList(id, restaurantId, sortOrder);
    return success(c, added, 201);
  }
);

adminRoutes.delete("/curated-lists/:listId/restaurants/:restaurantId", requireAdmin, async (c) => {
  const { listId, restaurantId } = c.req.param();
  const removed = await removeRestaurantFromList(listId, restaurantId);
  if (!removed) return error(c, "NOT_FOUND", "Restaurant not in list", 404);
  return success(c, { deleted: true });
});

export { adminRoutes };
