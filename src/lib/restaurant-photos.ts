import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db/index.js";
import { restaurantPhoto } from "../db/schema.js";

export type RestaurantPhotoInput = {
  restaurantId?: string | null;
  outletId?: string | null;
  url: string;
  label?: string | null;
  imagekitFileId?: string | null;
  imagekitUrl?: string | null;
  sortOrder?: number | null;
};

export type RestaurantPhotoTransaction = {
  transaction: <T>(work: (tx: Transaction) => Promise<T>) => Promise<T>;
};

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export function normalizeRestaurantPhotoSortOrder(sortOrder?: number | null): number {
  return Number.isInteger(sortOrder) && (sortOrder ?? 0) >= 0 ? (sortOrder as number) : 0;
}

export function normalizeRestaurantPhotoInput(input: RestaurantPhotoInput): RestaurantPhotoInput {
  return {
    ...input,
    sortOrder: normalizeRestaurantPhotoSortOrder(input.sortOrder),
  };
}

export async function withRestaurantPhotoTransaction<T>(
  db: RestaurantPhotoTransaction,
  work: (tx: Transaction) => Promise<T>
): Promise<T> {
  return db.transaction(work);
}

export async function replaceRestaurantPhotos(
  tx: Transaction,
  restaurantId: string,
  photos: RestaurantPhotoInput[]
): Promise<void> {
  await tx
    .delete(restaurantPhoto)
    .where(and(eq(restaurantPhoto.restaurantId, restaurantId), isNull(restaurantPhoto.outletId)));

  if (!photos.length) {
    return;
  }

  await tx.insert(restaurantPhoto).values(
    photos.map((photo, index) => {
      const normalized = normalizeRestaurantPhotoInput(photo);
      return {
        restaurantId,
        outletId: null,
        url: normalized.url,
        label: normalized.label ?? null,
        imagekitFileId: normalized.imagekitFileId ?? null,
        imagekitUrl: normalized.imagekitUrl ?? null,
        sortOrder: photo.sortOrder == null ? index : normalized.sortOrder ?? index,
      };
    })
  );
}

export async function replaceOutletPhotos(
  tx: Transaction,
  outletId: string,
  photos: RestaurantPhotoInput[]
): Promise<void> {
  await tx
    .delete(restaurantPhoto)
    .where(and(eq(restaurantPhoto.outletId, outletId), isNull(restaurantPhoto.restaurantId)));

  if (!photos.length) {
    return;
  }

  await tx.insert(restaurantPhoto).values(
    photos.map((photo, index) => {
      const normalized = normalizeRestaurantPhotoInput(photo);
      return {
        restaurantId: null,
        outletId,
        url: normalized.url,
        label: normalized.label ?? null,
        imagekitFileId: normalized.imagekitFileId ?? null,
        imagekitUrl: normalized.imagekitUrl ?? null,
        sortOrder: photo.sortOrder == null ? index : normalized.sortOrder ?? index,
      };
    })
  );
}
