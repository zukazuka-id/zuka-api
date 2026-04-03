import { Hono } from "hono";
import { db } from "../db/index.js";
import {
  restaurant,
  outlet,
  restaurantPhoto,
} from "../db/schema.js";
import { eq, ilike, or, and, inArray, sql } from "drizzle-orm";
import { success, paginated, error } from "../lib/response.js";

const restaurantRoutes = new Hono();

// GET /restaurants/discover
restaurantRoutes.get("/discover", async (c) => {
  const cuisine = c.req.query("cuisine");
  const page = parseInt(c.req.query("page") || "1");
  const limit = Math.min(parseInt(c.req.query("limit") || "20"), 50);
  const offset = (page - 1) * limit;

  const conditions = [eq(outlet.isOpen, true), eq(outlet.status, "active")];
  if (cuisine) {
    conditions.push(sql`${restaurant.cuisineTags} @> ARRAY[${cuisine}]`);
  }

  const where = and(...conditions);

  // Count distinct restaurants
  const [countResult] = await db
    .select({ count: sql<number>`count(distinct ${restaurant.id})` })
    .from(restaurant)
    .innerJoin(outlet, eq(restaurant.id, outlet.restaurantId))
    .where(where);

  // Fetch distinct restaurant IDs with pagination
  const distinctIds = await db
    .selectDistinct({ id: restaurant.id })
    .from(restaurant)
    .innerJoin(outlet, eq(restaurant.id, outlet.restaurantId))
    .where(where)
    .limit(limit)
    .offset(offset);

  if (distinctIds.length === 0) {
    return paginated(c, [], { page, limit, total: 0 });
  }

  // Fetch full data for those restaurant IDs
  const idList = distinctIds.map((r) => r.id);
  const rows = await db
    .select({
      id: restaurant.id,
      name: restaurant.name,
      description: restaurant.description,
      cuisineTags: restaurant.cuisineTags,
      halalCertified: restaurant.halalCertified,
      logo: restaurant.logo,
      outletId: outlet.id,
      outletLabel: outlet.label,
      outletAddress: outlet.address,
      lat: outlet.lat,
      lng: outlet.lng,
      isOpen: outlet.isOpen,
      bogoLimit: outlet.bogoLimit,
      avgTableSpend: outlet.avgTableSpend,
    })
    .from(restaurant)
    .innerJoin(outlet, eq(restaurant.id, outlet.restaurantId))
    .where(and(...conditions, inArray(restaurant.id, idList)));

  // Group outlets by restaurant
  const grouped = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    if (!grouped.has(row.id)) {
      grouped.set(row.id, {
        id: row.id,
        name: row.name,
        description: row.description,
        cuisineTags: row.cuisineTags,
        halalCertified: row.halalCertified,
        logo: row.logo,
        outlets: [],
      });
    }
    (grouped.get(row.id)!.outlets as Record<string, unknown>[]).push({
      id: row.outletId,
      label: row.outletLabel,
      address: row.outletAddress,
      lat: row.lat,
      lng: row.lng,
      isOpen: row.isOpen,
      bogoLimit: row.bogoLimit,
      avgTableSpend: row.avgTableSpend,
    });
  }

  const total = Number(countResult?.count || 0);
  return paginated(c, Array.from(grouped.values()), { page, limit, total });
});

// GET /restaurants/search?q=...
restaurantRoutes.get("/search", async (c) => {
  const q = c.req.query("q");
  if (!q) {
    return error(c, "VALIDATION_ERROR", "Search query 'q' is required", 400);
  }

  const results = await db
    .select({
      id: restaurant.id,
      name: restaurant.name,
      description: restaurant.description,
      cuisineTags: restaurant.cuisineTags,
      halalCertified: restaurant.halalCertified,
    })
    .from(restaurant)
    .where(
      or(
        ilike(restaurant.name, `%${q}%`),
        sql`${restaurant.cuisineTags}::text ILIKE ${"%" + q + "%"}`,
        ilike(restaurant.description, `%${q}%`)
      )
    )
    .limit(20);

  return success(c, results);
});

// GET /restaurants/:id — full detail with outlets + photos
restaurantRoutes.get("/:id", async (c) => {
  const id = c.req.param("id");

  const [rest] = await db
    .select()
    .from(restaurant)
    .where(eq(restaurant.id, id))
    .limit(1);

  if (!rest) {
    return error(c, "NOT_FOUND", "Restaurant not found", 404);
  }

  const outlets = await db
    .select()
    .from(outlet)
    .where(eq(outlet.restaurantId, id));

  // Attach photos to their respective outlets
  const outletIds = outlets.map((o) => o.id);
  const allPhotos = outletIds.length
    ? await db
        .select()
        .from(restaurantPhoto)
        .where(inArray(restaurantPhoto.outletId, outletIds))
    : [];

  const outletsWithPhotos = outlets.map((o) => ({
    ...o,
    photos: allPhotos.filter((p) => p.outletId === o.id),
  }));

  return success(c, { ...rest, outlets: outletsWithPhotos });
});

export { restaurantRoutes };
