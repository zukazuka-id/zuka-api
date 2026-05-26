import { Hono } from "hono";
import { db } from "../db/index.js";
import {
  restaurant,
  outlet,
  restaurantPhoto,
} from "../db/schema.js";
import { eq, ilike, or, and, inArray, sql, isNotNull, gt, lt, asc } from "drizzle-orm";
import { zValidator } from "@hono/zod-validator";
import { nearbyQuerySchema, sectionLimitSchema } from "../validators/index.js";
import { success, paginated, error } from "../lib/response.js";
import {
  getTrendingRestaurants,
  getNewRestaurants,
  getNearbyRestaurants,
  getPopularRestaurants,
  getRecommendedRestaurants,
} from "../lib/restaurant-curation-service.js";

type UserVars = {
  user: { id: string; name: string; email: string; [key: string]: unknown };
  session: { id: string; token: string; [key: string]: unknown };
  userRoles: { role: string; outletId: string }[];
};

const restaurantRoutes = new Hono<{ Variables: UserVars }>();

type GroupedRestaurantOutlet = {
  id: string;
  label: string;
  address: string;
  lat: number | null;
  lng: number | null;
  isOpen: boolean | null;
  bogoLimit: number | null;
  avgTableSpend: number | null;
  photos?: Array<Record<string, unknown>>;
};

type GroupedRestaurant = {
  id: string;
  name: string;
  description: string | null;
  cuisineTags: string[] | null;
  halalCertified: boolean | null;
  logo: string | null;
  photos?: Array<Record<string, unknown>>;
  outlets: GroupedRestaurantOutlet[];
};

function groupRestaurantsFromRows(rows: Array<{
  id: string;
  name: string;
  description: string | null;
  cuisineTags: string[] | null;
  halalCertified: boolean | null;
  logo: string | null;
  outletId: string;
  outletLabel: string;
  outletAddress: string;
  lat: number | null;
  lng: number | null;
  isOpen: boolean | null;
  bogoLimit: number | null;
  avgTableSpend: number | null;
}>): Map<string, GroupedRestaurant> {
  const grouped = new Map<string, GroupedRestaurant>();

  for (const row of rows) {
    if (!grouped.has(row.id)) {
      grouped.set(row.id, {
        id: row.id,
        name: row.name,
        description: row.description,
        cuisineTags: row.cuisineTags,
        halalCertified: row.halalCertified,
        logo: row.logo,
        photos: [],
        outlets: [],
      });
    }

    grouped.get(row.id)!.outlets.push({
      id: row.outletId,
      label: row.outletLabel,
      address: row.outletAddress,
      lat: row.lat,
      lng: row.lng,
      isOpen: row.isOpen,
      bogoLimit: row.bogoLimit,
      avgTableSpend: row.avgTableSpend,
      photos: [],
    });
  }

  return grouped;
}

async function attachPhotosToGroupedRestaurants(
  grouped: Map<string, GroupedRestaurant>,
) {
  const restaurantIds = Array.from(grouped.keys());
  const outletIds = Array.from(grouped.values()).flatMap((resto) =>
    resto.outlets.map((out) => out.id),
  );

  const restaurantLevelPhotos = restaurantIds.length
    ? await db
        .select()
        .from(restaurantPhoto)
        .where(inArray(restaurantPhoto.restaurantId, restaurantIds))
        .orderBy(asc(restaurantPhoto.sortOrder), asc(restaurantPhoto.createdAt))
    : [];

  const outletLevelPhotos = outletIds.length
    ? await db
        .select()
        .from(restaurantPhoto)
        .where(inArray(restaurantPhoto.outletId, outletIds))
        .orderBy(asc(restaurantPhoto.sortOrder), asc(restaurantPhoto.createdAt))
    : [];

  const restaurantPhotoMap = new Map<string, typeof restaurantLevelPhotos>();
  for (const photo of restaurantLevelPhotos) {
    const bucket = restaurantPhotoMap.get(photo.restaurantId!) ?? [];
    bucket.push(photo);
    restaurantPhotoMap.set(photo.restaurantId!, bucket);
  }

  const outletPhotoMap = new Map<string, typeof outletLevelPhotos>();
  for (const photo of outletLevelPhotos) {
    const bucket = outletPhotoMap.get(photo.outletId!) ?? [];
    bucket.push(photo);
    outletPhotoMap.set(photo.outletId!, bucket);
  }

  for (const groupedRestaurant of grouped.values()) {
    groupedRestaurant.photos = restaurantPhotoMap.get(groupedRestaurant.id) ?? [];
    groupedRestaurant.outlets = groupedRestaurant.outlets.map((out) => ({
      ...out,
      photos: outletPhotoMap.get(out.id) ?? [],
    }));
  }
}

// GET /restaurants/discover
restaurantRoutes.get("/discover", async (c) => {
  const cuisine = c.req.query("cuisine");
  const page = parseInt(c.req.query("page") || "1");
  const limit = Math.min(parseInt(c.req.query("limit") || "20"), 50);
  const offset = (page - 1) * limit;

  const conditions = [eq(restaurant.status, "active"), eq(outlet.status, "active")];
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

  const grouped = groupRestaurantsFromRows(rows);
  await attachPhotosToGroupedRestaurants(grouped);

  const total = Number(countResult?.count || 0);
  return paginated(c, Array.from(grouped.values()), { page, limit, total });
});

// GET /restaurants/search?q=...
restaurantRoutes.get("/search", async (c) => {
  const q = c.req.query("q");
  if (!q) {
    return error(c, "VALIDATION_ERROR", "Search query 'q' is required", 400);
  }

  const distinctIds = await db
    .selectDistinct({ id: restaurant.id })
    .from(restaurant)
    .innerJoin(outlet, eq(restaurant.id, outlet.restaurantId))
    .where(
      and(
        eq(restaurant.status, "active"),
        eq(outlet.status, "active"),
        or(
          ilike(restaurant.name, `%${q}%`),
          sql`${restaurant.cuisineTags}::text ILIKE ${"%" + q + "%"}`,
          ilike(restaurant.description, `%${q}%`)
        )
      )
    )
    .limit(20);

  if (distinctIds.length === 0) {
    return success(c, []);
  }

  const idList = distinctIds.map((row) => row.id);
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
    .where(
      and(
        eq(restaurant.status, "active"),
        eq(outlet.status, "active"),
        inArray(restaurant.id, idList),
      ),
    );

  const grouped = groupRestaurantsFromRows(rows);
  await attachPhotosToGroupedRestaurants(grouped);

  return success(c, Array.from(grouped.values()));
});

// GET /restaurants/nearby — public, geolocation-based discovery
restaurantRoutes.get("/nearby", zValidator("query", nearbyQuerySchema), async (c) => {
  const { lat, lng, radius } = c.req.valid("query");

  // Bounding box prefilter
  const latRad = (lat * Math.PI) / 180;
  const kmPerDegLat = 111.045;
  const kmPerDegLng = 111.045 * Math.cos(latRad);
  const latMin = lat - radius / kmPerDegLat;
  const latMax = lat + radius / kmPerDegLat;
  const lngMin = lng - radius / kmPerDegLng;
  const lngMax = lng + radius / kmPerDegLng;

  const candidates = await db
    .select({
      restaurantId: restaurant.id,
      restaurantName: restaurant.name,
      restaurantDescription: restaurant.description,
      restaurantLogo: restaurant.logo,
      cuisineTags: restaurant.cuisineTags,
      halalCertified: restaurant.halalCertified,
      outletId: outlet.id,
      outletLabel: outlet.label,
      outletAddress: outlet.address,
      outletIsOpen: outlet.isOpen,
      outletBogoLimit: outlet.bogoLimit,
      distanceKm: sql<number>`
        6371 * acos(
          least(1.0,
            cos(radians(${lat})) * cos(radians(${outlet.lat}))
              * cos(radians(${outlet.lng}) - radians(${lng}))
            + sin(radians(${lat})) * sin(radians(${outlet.lat}))
          )
        )
      `.as("distance_km"),
    })
    .from(outlet)
    .innerJoin(restaurant, eq(outlet.restaurantId, restaurant.id))
    .where(
      and(
        gt(outlet.lat, latMin),
        lt(outlet.lat, latMax),
        gt(outlet.lng, lngMin),
        lt(outlet.lng, lngMax),
        eq(restaurant.status, "active"),
        eq(outlet.status, "active"),
        isNotNull(outlet.lat),
        isNotNull(outlet.lng),
      )
    );

  const withinRadius = candidates.filter((r) => r.distanceKm <= radius);

  const nearestByRestaurant = new Map<string, {
    id: string;
    name: string;
    description: string | null;
    logo: string | null;
    cuisineTags: string[] | null;
    halalCertified: boolean | null;
    nearestOutlet: {
      id: string;
      label: string;
      address: string;
      distanceKm: number;
      isOpen: boolean | null;
      bogoLimit: number | null;
    };
  }>();

  for (const row of withinRadius) {
    const existing = nearestByRestaurant.get(row.restaurantId);
    if (!existing || row.distanceKm < existing.nearestOutlet.distanceKm) {
      nearestByRestaurant.set(row.restaurantId, {
        id: row.restaurantId,
        name: row.restaurantName,
        description: row.restaurantDescription,
        logo: row.restaurantLogo,
        cuisineTags: row.cuisineTags,
        halalCertified: row.halalCertified,
        nearestOutlet: {
          id: row.outletId,
          label: row.outletLabel,
          address: row.outletAddress,
          distanceKm: Math.round(row.distanceKm * 10) / 10,
          isOpen: row.outletIsOpen,
          bogoLimit: row.outletBogoLimit,
        },
      });
    }
  }

  const restaurants = Array.from(nearestByRestaurant.values())
    .sort((a, b) => a.nearestOutlet.distanceKm - b.nearestOutlet.distanceKm)
    .slice(0, 20);

  return success(c, { restaurants });
});

// GET /restaurants/trending — trending restaurants (most redeemed this week)
restaurantRoutes.get("/trending", zValidator("query", sectionLimitSchema), async (c) => {
  const { limit } = c.req.valid("query");
  const data = await getTrendingRestaurants(limit);
  return success(c, data);
});

// GET /restaurants/new — recently added restaurants
restaurantRoutes.get("/new", zValidator("query", sectionLimitSchema), async (c) => {
  const { limit } = c.req.valid("query");
  const data = await getNewRestaurants(limit);
  return success(c, data);
});

// GET /restaurants/popular — most redeemed all time
restaurantRoutes.get(
  "/popular",
  zValidator("query", sectionLimitSchema),
  async (c) => {
    const { limit } = c.req.valid("query");
    const latStr = c.req.query("lat");
    const lngStr = c.req.query("lng");
    const lat = latStr ? parseFloat(latStr) : undefined;
    const lng = lngStr ? parseFloat(lngStr) : undefined;

    const data = await getPopularRestaurants(
      lat != null && !isNaN(lat) ? lat : undefined,
      lng != null && !isNaN(lng) ? lng : undefined,
      limit
    );
    return success(c, data);
  }
);

// GET /restaurants/recommended — personalized or fallback to popular
restaurantRoutes.get(
  "/recommended",
  zValidator("query", sectionLimitSchema),
  async (c) => {
    const { limit } = c.req.valid("query");
    const latStr = c.req.query("lat");
    const lngStr = c.req.query("lng");
    const lat = latStr ? parseFloat(latStr) : undefined;
    const lng = lngStr ? parseFloat(lngStr) : undefined;
    const accountId = c.get("user")?.id as string | null;

    const data = await getRecommendedRestaurants(
      accountId,
      lat != null && !isNaN(lat) ? lat : undefined,
      lng != null && !isNaN(lng) ? lng : undefined,
      limit
    );
    return success(c, data);
  }
);

// GET /restaurants/:id — full detail with outlets + photos
restaurantRoutes.get("/:id", async (c) => {
  const id = c.req.param("id");

  const [rest] = await db
    .select()
    .from(restaurant)
    .where(and(eq(restaurant.id, id), eq(restaurant.status, "active")))
    .limit(1);

  if (!rest) {
    return error(c, "NOT_FOUND", "Restaurant not found", 404);
  }

  const outlets = await db
    .select()
    .from(outlet)
    .where(and(eq(outlet.restaurantId, id), eq(outlet.status, "active")));

  const restaurantLevelPhotos = await db
    .select()
    .from(restaurantPhoto)
    .where(eq(restaurantPhoto.restaurantId, id))
    .orderBy(asc(restaurantPhoto.sortOrder), asc(restaurantPhoto.createdAt));

  // Attach photos to their respective outlets
  const outletIds = outlets.map((o) => o.id);
  const allPhotos = outletIds.length
    ? await db
        .select()
        .from(restaurantPhoto)
        .where(inArray(restaurantPhoto.outletId, outletIds))
        .orderBy(asc(restaurantPhoto.sortOrder), asc(restaurantPhoto.createdAt))
    : [];

  const outletsWithPhotos = outlets.map((o) => ({
    ...o,
    photos: allPhotos.filter((p) => p.outletId === o.id),
  }));

  return success(c, {
    ...rest,
    photos: restaurantLevelPhotos,
    outlets: outletsWithPhotos,
  });
});

export { restaurantRoutes };
