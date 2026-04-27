import { describe, it, expect, afterAll } from "vitest";
import { app } from "../../app.js";
import { db } from "../../db/index.js";
import { banner, curatedList, curatedListRestaurant, restaurant, outlet } from "../../db/schema.js";
import { eq } from "drizzle-orm";

const createdBannerIds: string[] = [];
const createdCuratedListIds: string[] = [];
const createdRestaurantIds: string[] = [];
const createdOutletIds: string[] = [];

afterAll(async () => {
  for (const id of createdBannerIds) {
    await db.delete(banner).where(eq(banner.id, id));
  }
  for (const id of createdCuratedListIds) {
    await db.delete(curatedList).where(eq(curatedList.id, id));
  }
  for (const id of createdOutletIds) {
    await db.delete(outlet).where(eq(outlet.id, id));
  }
  for (const id of createdRestaurantIds) {
    await db.delete(restaurant).where(eq(restaurant.id, id));
  }
});

describe("Homepage Integration Tests", () => {
  describe("GET /api/v1/banners", () => {
    it("returns active banners within the date window", async () => {
      const [b] = await db
        .insert(banner)
        .values({
          title: "Test Active Banner",
          imageUrl: "https://example.com/banner.jpg",
          startsAt: new Date(Date.now() - 86400000),
          endsAt: new Date(Date.now() + 86400000),
          sortOrder: 0,
          isActive: true,
        })
        .returning();
      createdBannerIds.push(b.id);

      const res = await app.request("/api/v1/banners");
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      const found = body.data.find((row: { id: string }) => row.id === b.id);
      expect(found).toBeDefined();
      expect(found.title).toBe("Test Active Banner");
      expect(found.imageUrl).toBe("https://example.com/banner.jpg");
    });

    it("excludes banners outside the date window", async () => {
      const [b] = await db
        .insert(banner)
        .values({
          title: "Test Expired Banner",
          imageUrl: "https://example.com/expired.jpg",
          startsAt: new Date(Date.now() - 172800000),
          endsAt: new Date(Date.now() - 86400000),
          sortOrder: 0,
          isActive: true,
        })
        .returning();
      createdBannerIds.push(b.id);

      const res = await app.request("/api/v1/banners");
      const body = await res.json();

      const found = body.data.find((row: { id: string }) => row.id === b.id);
      expect(found).toBeUndefined();
    });
  });

  describe("GET /api/v1/curated-lists", () => {
    it("returns active curated lists with restaurants", async () => {
      const [rest] = await db
        .insert(restaurant)
        .values({
          name: `Curated Test Rest ${Date.now()}`,
          status: "active",
          cuisineTags: ["test-cuisine"],
        })
        .returning();
      createdRestaurantIds.push(rest.id);

      const [out] = await db
        .insert(outlet)
        .values({
          restaurantId: rest.id,
          label: "Curated Test Outlet",
          address: "Jl. Test No. 1",
          status: "active",
          lat: -6.2,
          lng: 106.8,
        })
        .returning();
      createdOutletIds.push(out.id);

      const [list] = await db
        .insert(curatedList)
        .values({
          title: "Test Curated List",
          isActive: true,
          sortOrder: 0,
        })
        .returning();
      createdCuratedListIds.push(list.id);

      await db.insert(curatedListRestaurant).values({
        curatedListId: list.id,
        restaurantId: rest.id,
        sortOrder: 0,
      });

      const res = await app.request("/api/v1/curated-lists");
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      const found = body.data.find((row: { id: string }) => row.id === list.id);
      expect(found).toBeDefined();
      expect(found.title).toBe("Test Curated List");
      expect(found.restaurants.length).toBeGreaterThan(0);
      expect(found.restaurants[0].id).toBe(rest.id);
      expect(found.restaurants[0].name).toBe(rest.name);
    });

    it("supports lat/lng for distance calculation", async () => {
      const res = await app.request("/api/v1/curated-lists?lat=-6.2&lng=106.8");
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
    });
  });

  describe("GET /api/v1/restaurants/trending", () => {
    it("returns trending restaurants", async () => {
      const res = await app.request("/api/v1/restaurants/trending?limit=5");
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);
    });
  });

  describe("GET /api/v1/restaurants/new", () => {
    it("returns new restaurants", async () => {
      const res = await app.request("/api/v1/restaurants/new?limit=5");
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);
    });
  });

  describe("GET /api/v1/restaurants/popular", () => {
    it("returns popular restaurants", async () => {
      const res = await app.request("/api/v1/restaurants/popular?limit=5");
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);
    });
  });

  describe("GET /api/v1/restaurants/recommended", () => {
    it("returns recommended restaurants (public, falls back to popular)", async () => {
      const res = await app.request("/api/v1/restaurants/recommended?limit=5");
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);
    });
  });
});
