import { describe, it, expect } from "vitest";
import { app } from "../../app.js";

describe("Restaurants Integration Tests", () => {
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
