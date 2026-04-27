import { db } from "../db/index.js";
import { banner } from "../db/schema.js";
import { eq, and, lte, gte, sql } from "drizzle-orm";
import type { z } from "zod";
import type { createBannerSchema, updateBannerSchema } from "../validators/index.js";

export async function getActiveBanners() {
  return db
    .select({
      id: banner.id,
      title: banner.title,
      imageUrl: banner.imageUrl,
      linkType: banner.linkType,
      linkRef: banner.linkRef,
    })
    .from(banner)
    .where(
      and(
        eq(banner.isActive, true),
        lte(banner.startsAt, sql`now()`),
        gte(banner.endsAt, sql`now()`)
      )
    )
    .orderBy(banner.sortOrder);
}

export async function getAllBanners(includeInactive = false) {
  const conditions = includeInactive
    ? undefined
    : eq(banner.isActive, true);

  return db
    .select()
    .from(banner)
    .where(conditions)
    .orderBy(banner.sortOrder);
}

export async function createBanner(data: z.infer<typeof createBannerSchema>) {
  const [created] = await db
    .insert(banner)
    .values({
      title: data.title,
      imageUrl: data.imageUrl,
      linkType: data.linkType ?? null,
      linkRef: data.linkRef ?? null,
      startsAt: new Date(data.startsAt),
      endsAt: new Date(data.endsAt),
      sortOrder: data.sortOrder ?? 0,
    })
    .returning();
  return created;
}

export async function updateBanner(id: string, data: z.infer<typeof updateBannerSchema>) {
  const updates: Record<string, unknown> = {};
  if (data.title !== undefined) updates.title = data.title;
  if (data.imageUrl !== undefined) updates.imageUrl = data.imageUrl;
  if (data.linkType !== undefined) updates.linkType = data.linkType;
  if (data.linkRef !== undefined) updates.linkRef = data.linkRef;
  if (data.startsAt !== undefined) updates.startsAt = new Date(data.startsAt);
  if (data.endsAt !== undefined) updates.endsAt = new Date(data.endsAt);
  if (data.sortOrder !== undefined) updates.sortOrder = data.sortOrder;

  if (Object.keys(updates).length === 0) {
    const [existing] = await db.select().from(banner).where(eq(banner.id, id)).limit(1);
    return existing ?? null;
  }

  const [updated] = await db
    .update(banner)
    .set(updates)
    .where(eq(banner.id, id))
    .returning();
  return updated ?? null;
}

export async function deleteBanner(id: string) {
  const [deleted] = await db.delete(banner).where(eq(banner.id, id)).returning();
  return deleted ?? null;
}
