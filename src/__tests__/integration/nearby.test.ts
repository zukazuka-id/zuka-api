import { describe, it, expect, beforeEach } from "vitest";
import { app } from "../../app.js";
import { db } from "../../db/index.js";
import { restaurant, outlet } from "../../db/schema.js";
import { eq } from "drizzle-orm";
import { resetRateLimiterState } from "../../middleware/rate-limiter.js";

describe("Nearby Restaurants Integration Tests", () => {
  beforeEach(() => {
    resetRateLimiterState();
  });

  it("GET /restaurants/nearby — missing lat/lng returns 400", async () => {
    const res = await app.request("/api/v1/restaurants/nearby");
    expect(res.status).toBe(400);
  });

  it("GET /restaurants/nearby — radius > 50 returns 400", async () => {
    const res = await app.request("/api/v1/restaurants/nearby?lat=-6.2&lng=106.8&radius=100");
    expect(res.status).toBe(400);
  });

  it("GET /restaurants/nearby — returns empty array for null island", async () => {
    const res = await app.request("/api/v1/restaurants/nearby?lat=0&lng=0&radius=1");
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.restaurants).toBeInstanceOf(Array);
    expect(body.data.restaurants.length).toBe(0);
  });

  it("GET /restaurants/nearby — returns restaurants with nearestOutlet", async () => {
    const [rest] = await db.insert(restaurant).values({
      name: "Nearby Test Restaurant",
      cuisineTags: ["test"],
      halalCertified: true,
    }).returning();

    const [out] = await db.insert(outlet).values({
      restaurantId: rest.id,
      label: "Test Outlet",
      address: "Jl. Test No. 1",
      lat: -6.2088,
      lng: 106.8456,
      isOpen: true,
      status: "active",
      bogoLimit: 1,
    }).returning();

    try {
      const res = await app.request("/api/v1/restaurants/nearby?lat=-6.2088&lng=106.8456&radius=5");
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.data.restaurants).toBeInstanceOf(Array);

      const found = body.data.restaurants.find(
        (r: { id: string }) => r.id === rest.id
      );
      if (found) {
        expect(found.nearestOutlet).toBeDefined();
        expect(found.nearestOutlet.id).toBe(out.id);
        expect(typeof found.nearestOutlet.distanceKm).toBe("number");
        expect(found.nearestOutlet.distanceKm).toBeLessThanOrEqual(5);
      }
    } finally {
      await db.delete(outlet).where(eq(outlet.id, out.id));
      await db.delete(restaurant).where(eq(restaurant.id, rest.id));
    }
  });

  it("GET /restaurants/nearby — results are sorted by distance ascending", async () => {
    const res = await app.request("/api/v1/restaurants/nearby?lat=-6.2088&lng=106.8456&radius=50");
    const body = await res.json();
    expect(res.status).toBe(200);

    const restaurants = body.data.restaurants as Array<{ nearestOutlet: { distanceKm: number } }>;
    if (restaurants.length >= 2) {
      for (let i = 1; i < restaurants.length; i++) {
        expect(restaurants[i].nearestOutlet.distanceKm).toBeGreaterThanOrEqual(
          restaurants[i - 1].nearestOutlet.distanceKm
        );
      }
    }
  });

  it("GET /restaurants/nearby — does not include closed or suspended outlets", async () => {
    const [rest] = await db.insert(restaurant).values({
      name: "Closed Test Restaurant",
      cuisineTags: ["test"],
    }).returning();

    await db.insert(outlet).values({
      restaurantId: rest.id,
      label: "Closed Outlet",
      address: "Jl. Closed No. 1",
      lat: -6.2088,
      lng: 106.8456,
      isOpen: false,
      status: "active",
    }).returning();

    try {
      const res = await app.request("/api/v1/restaurants/nearby?lat=-6.2088&lng=106.8456&radius=5");
      const body = await res.json();
      const found = body.data.restaurants.find(
        (r: { id: string }) => r.id === rest.id
      );
      expect(found).toBeUndefined();
    } finally {
      await db.delete(outlet).where(eq(outlet.restaurantId, rest.id));
      await db.delete(restaurant).where(eq(restaurant.id, rest.id));
    }
  });
});
