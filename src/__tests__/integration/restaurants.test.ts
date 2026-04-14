import { describe, it, expect, afterAll } from "vitest";
import { app } from "../../app.js";
import { db } from "../../db/index.js";
import { restaurant, outlet } from "../../db/schema.js";
import { and, eq } from "drizzle-orm";

const createdRestaurantIds: string[] = [];
const createdOutletIds: string[] = [];

afterAll(async () => {
  for (const id of createdOutletIds) {
    await db.delete(outlet).where(eq(outlet.id, id));
  }

  for (const id of createdRestaurantIds) {
    await db.delete(restaurant).where(eq(restaurant.id, id));
  }
});

describe("Restaurants Integration Tests", () => {
  it("GET /restaurants/discover — includes active outlets even when closed and exposes isOpen", async () => {
    const [rest] = await db
      .insert(restaurant)
      .values({
        name: `Discover Closed ${Date.now()}`,
        status: "active",
        cuisineTags: ["discover-closed"],
      })
      .returning();
    createdRestaurantIds.push(rest.id);

    const [out] = await db
      .insert(outlet)
      .values({
        restaurantId: rest.id,
        label: "Discover Closed Outlet",
        address: "Jl. Discover Closed No. 1",
        status: "active",
        isOpen: false,
        lat: -6.2,
        lng: 106.8,
      })
      .returning();
    createdOutletIds.push(out.id);

    const res = await app.request("/api/v1/restaurants/discover?cuisine=discover-closed");
    const body = await res.json();

    expect(res.status).toBe(200);
    const found = body.data.find((row: { id: string }) => row.id === rest.id);
    expect(found).toBeDefined();
    expect(found.outlets.some((row: { id: string }) => row.id === out.id)).toBe(true);
    expect(found.outlets.find((row: { id: string }) => row.id === out.id)?.isOpen).toBe(false);
  });

  it("GET /restaurants/discover — hides suspended restaurants even when their outlets are active", async () => {
    const [rest] = await db
      .insert(restaurant)
      .values({
        name: `Discover Suspended ${Date.now()}`,
        status: "suspended",
        cuisineTags: ["discover-suspended"],
      })
      .returning();
    createdRestaurantIds.push(rest.id);

    const [out] = await db
      .insert(outlet)
      .values({
        restaurantId: rest.id,
        label: "Discover Suspended Outlet",
        address: "Jl. Discover Suspended No. 1",
        status: "active",
        isOpen: true,
        lat: -6.21,
        lng: 106.81,
      })
      .returning();
    createdOutletIds.push(out.id);

    const res = await app.request("/api/v1/restaurants/discover?cuisine=discover-suspended");
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.some((row: { id: string }) => row.id === rest.id)).toBe(false);
  });

  it("GET /restaurants/:id — hides suspended outlets but keeps active closed outlets visible", async () => {
    const [rest] = await db
      .insert(restaurant)
      .values({
        name: `Detail Visibility ${Date.now()}`,
        status: "active",
      })
      .returning();
    createdRestaurantIds.push(rest.id);

    const [activeClosedOutlet] = await db
      .insert(outlet)
      .values({
        restaurantId: rest.id,
        label: "Detail Active Closed Outlet",
        address: "Jl. Detail Active Closed No. 1",
        status: "active",
        isOpen: false,
        lat: -6.22,
        lng: 106.82,
      })
      .returning();
    createdOutletIds.push(activeClosedOutlet.id);

    const [suspendedOutlet] = await db
      .insert(outlet)
      .values({
        restaurantId: rest.id,
        label: "Detail Suspended Outlet",
        address: "Jl. Detail Suspended No. 1",
        status: "suspended",
        isOpen: true,
        lat: -6.23,
        lng: 106.83,
      })
      .returning();
    createdOutletIds.push(suspendedOutlet.id);

    const res = await app.request(`/api/v1/restaurants/${rest.id}`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.outlets.some((row: { id: string }) => row.id === activeClosedOutlet.id)).toBe(true);
    expect(body.data.outlets.find((row: { id: string }) => row.id === activeClosedOutlet.id)?.isOpen).toBe(false);
    expect(body.data.outlets.some((row: { id: string }) => row.id === suspendedOutlet.id)).toBe(false);
  });

  it("GET /restaurants/:id — hides suspended restaurants", async () => {
    const [rest] = await db
      .insert(restaurant)
      .values({
        name: `Detail Suspended Restaurant ${Date.now()}`,
        status: "suspended",
      })
      .returning();
    createdRestaurantIds.push(rest.id);

    const [out] = await db
      .insert(outlet)
      .values({
        restaurantId: rest.id,
        label: "Detail Suspended Restaurant Outlet",
        address: "Jl. Detail Suspended Restaurant No. 1",
        status: "active",
        isOpen: true,
        lat: -6.24,
        lng: 106.84,
      })
      .returning();
    createdOutletIds.push(out.id);

    const res = await app.request(`/api/v1/restaurants/${rest.id}`);

    expect(res.status).toBe(404);
  });

  it("GET /restaurants/discover — returns paginated results", async () => {
    const res = await app.request("/api/v1/restaurants/discover");
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.pagination).toBeDefined();
    expect(body.data).toBeInstanceOf(Array);
  });

  it("GET /restaurants/discover — supports pagination params", async () => {
    const res = await app.request("/api/v1/restaurants/discover?page=1&limit=5");
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.pagination.page).toBe(1);
    expect(body.pagination.limit).toBe(5);
    expect(body.data.length).toBeLessThanOrEqual(5);
  });

  it("GET /restaurants/discover — page beyond total returns empty array", async () => {
    const res = await app.request("/api/v1/restaurants/discover?page=9999&limit=10");
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data).toBeInstanceOf(Array);
  });

  it("GET /restaurants/discover — cuisine filter", async () => {
    const res = await app.request("/api/v1/restaurants/discover?cuisine=nasi");
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
  });

  it("GET /restaurants/search — requires query param", async () => {
    const res = await app.request("/api/v1/restaurants/search");
    expect(res.status).toBe(400);
  });

  it("GET /restaurants/search — returns results for query", async () => {
    const res = await app.request("/api/v1/restaurants/search?q=warung");
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toBeInstanceOf(Array);
  });

  it("GET /restaurants/search — empty search returns empty array", async () => {
    const res = await app.request("/api/v1/restaurants/search?q=zzzznonexistent12345");
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data).toBeInstanceOf(Array);
  });

  it("GET /restaurants/:id — invalid ID returns 404", async () => {
    const res = await app.request("/api/v1/restaurants/nonexistent-id-here");
    expect(res.status).toBe(404);
  });
});
