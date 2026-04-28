import { db } from "../db/index.js";
import { restaurant, outlet, redemption, restaurantPhoto } from "../db/schema.js";
import { eq, and, sql, gte, desc } from "drizzle-orm";

const photoSubquery = sql<string>`coalesce(
  (SELECT rp.url FROM restaurant_photo rp WHERE rp.restaurant_id = ${restaurant.id} ORDER BY rp.sort_order LIMIT 1),
  ${restaurant.logo}
)`;

interface CuratedRestaurant {
  id: string;
  name: string;
  cuisine: string[] | null;
  distance: number | null;
  photo: string | null;
  isOpen: boolean | null;
}

const baseFields = {
  id: restaurant.id,
  name: restaurant.name,
  cuisine: restaurant.cuisineTags,
  photo: photoSubquery,
  isOpen: outlet.isOpen,
};

function distanceExpr(lat?: number, lng?: number) {
  return lat != null && lng != null
    ? sql`round(
        cast(
          6371 * acos(
            least(1.0,
              cos(radians(${lat})) * cos(radians(${outlet.lat}))
                * cos(radians(${outlet.lng}) - radians(${lng}))
              + sin(radians(${lat})) * sin(radians(${outlet.lat}))
            )
          ) as numeric
        ), 1
      ) as distance`
    : sql`cast(null as numeric) as distance`;
}

export async function getTrendingRestaurants(limit = 10): Promise<CuratedRestaurant[]> {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  return db
    .select({
      ...baseFields,
      distance: distanceExpr(),
      redemptionCount: sql<number>`count(${redemption.id})`,
    })
    .from(restaurant)
    .innerJoin(outlet, eq(outlet.restaurantId, restaurant.id))
    .innerJoin(redemption, eq(redemption.outletId, outlet.id))
    .where(
      and(
        eq(restaurant.status, "active"),
        gte(redemption.createdAt, sevenDaysAgo)
      )
    )
    .groupBy(restaurant.id, outlet.id)
    .orderBy(desc(sql`count(${redemption.id})`))
    .limit(limit) as Promise<CuratedRestaurant[]>;
}

export async function getNewRestaurants(limit = 10): Promise<CuratedRestaurant[]> {
  const fourteenDaysAgo = new Date();
  fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

  return db
    .select({
      ...baseFields,
      distance: distanceExpr(),
    })
    .from(restaurant)
    .innerJoin(outlet, eq(outlet.restaurantId, restaurant.id))
    .where(
      and(
        eq(restaurant.status, "active"),
        gte(restaurant.createdAt, fourteenDaysAgo)
      )
    )
    .orderBy(desc(restaurant.createdAt))
    .limit(limit) as Promise<CuratedRestaurant[]>;
}

export async function getNearbyRestaurants(lat: number, lng: number, limit = 10): Promise<CuratedRestaurant[]> {
  return db
    .select({
      ...baseFields,
      distance: distanceExpr(lat, lng),
    })
    .from(restaurant)
    .innerJoin(outlet, eq(outlet.restaurantId, restaurant.id))
    .where(eq(restaurant.status, "active"))
    .orderBy(sql`6371 * acos(least(1.0, cos(radians(${lat})) * cos(radians(${outlet.lat})) * cos(radians(${outlet.lng}) - radians(${lng})) + sin(radians(${lat})) * sin(radians(${outlet.lat}))))`)
    .limit(limit) as Promise<CuratedRestaurant[]>;
}

export async function getPopularRestaurants(lat?: number, lng?: number, limit = 10): Promise<CuratedRestaurant[]> {
  return db
    .select({
      ...baseFields,
      distance: distanceExpr(lat, lng),
      redemptionCount: sql<number>`count(${redemption.id})`,
    })
    .from(restaurant)
    .innerJoin(outlet, eq(outlet.restaurantId, restaurant.id))
    .leftJoin(redemption, eq(redemption.outletId, outlet.id))
    .where(eq(restaurant.status, "active"))
    .groupBy(restaurant.id, outlet.id)
    .orderBy(desc(sql`count(${redemption.id})`))
    .limit(limit) as Promise<CuratedRestaurant[]>;
}

export async function getRecommendedRestaurants(
  accountId: string | null,
  lat?: number,
  lng?: number,
  limit = 10
): Promise<CuratedRestaurant[]> {
  if (!accountId) {
    return getPopularRestaurants(lat, lng, limit);
  }

  const topCuisines = await db
    .select({
      cuisine: sql<string>`unnest(${restaurant.cuisineTags})`,
      count: sql<number>`count(*)`,
    })
    .from(redemption)
    .innerJoin(outlet, eq(redemption.outletId, outlet.id))
    .innerJoin(restaurant, eq(outlet.restaurantId, restaurant.id))
    .where(eq(redemption.accountId, accountId))
    .groupBy(sql`unnest(${restaurant.cuisineTags})`)
    .orderBy(desc(sql`count(*)`))
    .limit(3);

  if (topCuisines.length === 0) {
    return getPopularRestaurants(lat, lng, limit);
  }

  const cuisineList = topCuisines.map((c) => c.cuisine);
  const cuisineArray = sql`ARRAY[${sql.join(cuisineList.map((c) => sql`${c}`), sql`, `)}]::text[]`;

  return db
    .select({
      ...baseFields,
      distance: distanceExpr(lat, lng),
    })
    .from(restaurant)
    .innerJoin(outlet, eq(outlet.restaurantId, restaurant.id))
    .where(
      and(
        eq(restaurant.status, "active"),
        sql`${restaurant.cuisineTags} && ${cuisineArray}`
      )
    )
    .limit(limit) as Promise<CuratedRestaurant[]>;
}
