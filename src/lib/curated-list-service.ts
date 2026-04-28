import { db } from "../db/index.js";
import { curatedList, curatedListRestaurant, restaurant, outlet, restaurantPhoto } from "../db/schema.js";
import { eq, and, sql, asc } from "drizzle-orm";
import type { z } from "zod";
import type { createCuratedListSchema, updateCuratedListSchema } from "../validators/index.js";

const photoSubquery = sql<string>`coalesce(
  (SELECT rp.url FROM restaurant_photo rp WHERE rp.restaurant_id = ${restaurant.id} ORDER BY rp.sort_order LIMIT 1),
  ${restaurant.logo}
)`;

export async function getActiveCuratedLists(lat?: number, lng?: number) {
  const now = sql`now()`;
  const lists = await db
    .select()
    .from(curatedList)
    .where(
      and(
        eq(curatedList.isActive, true),
        sql`(${curatedList.startsAt} IS NULL OR ${curatedList.startsAt} <= ${now})`,
        sql`(${curatedList.endsAt} IS NULL OR ${curatedList.endsAt} >= ${now})`
      )
    )
    .orderBy(asc(curatedList.sortOrder));

  const result = [];
  for (const list of lists) {
    const restaurants = await getListRestaurants(list.id, lat, lng);
    result.push({
      id: list.id,
      title: list.title,
      subtitle: list.subtitle,
      tag: list.tag,
      restaurants,
    });
  }
  return result;
}

async function getListRestaurants(listId: string, lat?: number, lng?: number) {
  const distanceExpr =
    lat != null && lng != null
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

  const rows = await db
    .select({
      id: restaurant.id,
      name: restaurant.name,
      cuisine: restaurant.cuisineTags,
      distance: distanceExpr,
      photo: photoSubquery,
      isOpen: outlet.isOpen,
    })
    .from(curatedListRestaurant)
    .innerJoin(restaurant, eq(curatedListRestaurant.restaurantId, restaurant.id))
    .innerJoin(outlet, eq(outlet.restaurantId, restaurant.id))
    .where(eq(curatedListRestaurant.curatedListId, listId))
    .orderBy(asc(curatedListRestaurant.sortOrder))
    .limit(10);

  return rows;
}

export async function getAllCuratedLists(includeInactive = false) {
  return includeInactive
    ? db.select().from(curatedList).orderBy(asc(curatedList.sortOrder))
    : db.select().from(curatedList).where(eq(curatedList.isActive, true)).orderBy(asc(curatedList.sortOrder));
}

export async function createCuratedList(data: z.infer<typeof createCuratedListSchema>) {
  const [created] = await db
    .insert(curatedList)
    .values({
      title: data.title,
      subtitle: data.subtitle ?? null,
      tag: data.tag ?? null,
      sortOrder: data.sortOrder ?? 0,
      startsAt: data.startsAt ? new Date(data.startsAt) : null,
      endsAt: data.endsAt ? new Date(data.endsAt) : null,
    })
    .returning();

  if (data.restaurantIds?.length) {
    await db.insert(curatedListRestaurant).values(
      data.restaurantIds.map((rid, i) => ({
        curatedListId: created.id,
        restaurantId: rid,
        sortOrder: i,
      }))
    );
  }

  return created;
}

export async function updateCuratedList(id: string, data: z.infer<typeof updateCuratedListSchema>) {
  const updates: Record<string, unknown> = {};
  if (data.title !== undefined) updates.title = data.title;
  if (data.subtitle !== undefined) updates.subtitle = data.subtitle;
  if (data.tag !== undefined) updates.tag = data.tag;
  if (data.sortOrder !== undefined) updates.sortOrder = data.sortOrder;
  if (data.startsAt !== undefined) updates.startsAt = data.startsAt ? new Date(data.startsAt) : null;
  if (data.endsAt !== undefined) updates.endsAt = data.endsAt ? new Date(data.endsAt) : null;

  if (Object.keys(updates).length > 0) {
    await db.update(curatedList).set(updates).where(eq(curatedList.id, id));
  }

  if (data.restaurantIds !== undefined) {
    await db.delete(curatedListRestaurant).where(eq(curatedListRestaurant.curatedListId, id));
    if (data.restaurantIds.length > 0) {
      await db.insert(curatedListRestaurant).values(
        data.restaurantIds.map((rid, i) => ({
          curatedListId: id,
          restaurantId: rid,
          sortOrder: i,
        }))
      );
    }
  }

  const [updated] = await db.select().from(curatedList).where(eq(curatedList.id, id)).limit(1);
  return updated ?? null;
}

export async function deleteCuratedList(id: string) {
  await db.delete(curatedListRestaurant).where(eq(curatedListRestaurant.curatedListId, id));
  const [deleted] = await db.delete(curatedList).where(eq(curatedList.id, id)).returning();
  return deleted ?? null;
}

export async function addRestaurantToList(listId: string, restaurantId: string, sortOrder = 0) {
  const [created] = await db
    .insert(curatedListRestaurant)
    .values({ curatedListId: listId, restaurantId, sortOrder })
    .returning();
  return created;
}

export async function removeRestaurantFromList(listId: string, restaurantId: string) {
  const [deleted] = await db
    .delete(curatedListRestaurant)
    .where(
      and(
        eq(curatedListRestaurant.curatedListId, listId),
        eq(curatedListRestaurant.restaurantId, restaurantId)
      )
    )
    .returning();
  return deleted ?? null;
}
