import { describe, it, expect, afterAll } from "vitest";
import { app } from "../../app.js";
import { db } from "../../db/index.js";
import { user, session, subscription, redemption, outlet, restaurant } from "../../db/schema.js";
import { eq } from "drizzle-orm";

const TEST_PHONE = `+628${Date.now().toString().slice(-9)}`;
let sessionToken = "";
let userId = "";
let testOutletId = "";
let testRestaurantId = "";

async function setupUserWithSubscriptionAndOutlet() {
  // Register user
  await app.request("/api/v1/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phoneNumber: TEST_PHONE }),
  });
  const verify = await app.request("/api/v1/auth/verify-otp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phoneNumber: TEST_PHONE, code: "123456" }),
  });
  const body = await verify.json();
  sessionToken = body.data?.token ?? body.data?.session?.token ?? "";
  userId = body.data?.user?.id ?? "";

  // Create subscription
  await app.request("/api/v1/subscription/create", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionToken}` },
    body: JSON.stringify({ plan: "yearly" }),
  });

  // Create test restaurant + outlet for redemption
  const [rest] = await db.insert(restaurant).values({
    name: `Test Restaurant ${Date.now()}`,
    description: "Integration test restaurant",
    cuisineTags: ["nasi"],
  }).returning();
  testRestaurantId = rest.id;

  const [out] = await db.insert(outlet).values({
    restaurantId: rest.id,
    label: "Test Outlet",
    address: "Jl. Test No. 1",
    isOpen: true,
    status: "active",
    lat: -6.2,
    lng: 106.8,
  }).returning();
  testOutletId = out.id;
}

describe("Redemptions Integration Tests", () => {
  afterAll(async () => {
    // Cleanup in reverse order
    if (testOutletId) {
      await db.delete(redemption).where(eq(redemption.outletId, testOutletId));
      await db.delete(outlet).where(eq(outlet.id, testOutletId));
    }
    if (testRestaurantId) {
      await db.delete(restaurant).where(eq(restaurant.id, testRestaurantId));
    }
    if (userId) {
      await db.delete(subscription).where(eq(subscription.accountId, userId));
      await db.delete(session).where(eq(session.userId, userId));
      await db.delete(user).where(eq(user.id, userId));
    }
  });

  it("POST /redemptions/create — requires auth", async () => {
    const res = await app.request("/api/v1/redemptions/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ outletId: "fake-id" }),
    });
    expect(res.status).toBe(401);
  });

  it("POST /redemptions/create — requires subscription", async () => {
    // Create a test outlet for this test
    const [rest] = await db.insert(restaurant).values({
      name: `Test Restaurant NoSub ${Date.now()}`,
      description: "Integration test",
      cuisineTags: ["nasi"],
    }).returning();
    const [out] = await db.insert(outlet).values({
      restaurantId: rest.id,
      label: "Test Outlet NoSub",
      address: "Jl. Test No. 2",
      isOpen: true,
      status: "active",
      lat: -6.2,
      lng: 106.8,
    }).returning();

    // User without subscription
    const phone2 = `+628${Date.now().toString().slice(-8)}3`;
    await app.request("/api/v1/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phoneNumber: phone2 }),
    });
    const verify = await app.request("/api/v1/auth/verify-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phoneNumber: phone2, code: "123456" }),
    });
    const vBody = await verify.json();
    const token2 = vBody.data?.token ?? vBody.data?.session?.token ?? "";
    const userId2 = vBody.data?.user?.id ?? "";

    const res = await app.request("/api/v1/redemptions/create", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token2}` },
      body: JSON.stringify({ outletId: out.id }),
    });
    expect(res.status).toBe(403);

    // Cleanup
    await db.delete(outlet).where(eq(outlet.id, out.id));
    await db.delete(restaurant).where(eq(restaurant.id, rest.id));

    if (userId2) {
      await db.delete(session).where(eq(session.userId, userId2));
      await db.delete(user).where(eq(user.id, userId2));
    }
  });

  it("POST /redemptions/create — creates redemption with valid subscription", async () => {
    await setupUserWithSubscriptionAndOutlet();
    const res = await app.request("/api/v1/redemptions/create", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionToken}` },
      body: JSON.stringify({ outletId: testOutletId }),
    });
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.data.qrToken).toBeTruthy();
    expect(body.data.expiresAt).toBeTruthy();
  });

  it("POST /redemptions/create — duplicate redemption returns 409", async () => {
    const res = await app.request("/api/v1/redemptions/create", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionToken}` },
      body: JSON.stringify({ outletId: testOutletId }),
    });
    expect(res.status).toBe(409);
  });

  it("GET /redemptions/my — returns redemption history", async () => {
    const res = await app.request("/api/v1/redemptions/my", {
      headers: { Authorization: `Bearer ${sessionToken}` },
    });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toBeInstanceOf(Array);
    expect(body.data.length).toBeGreaterThanOrEqual(1);
  });

  it("POST /redemptions/create — missing outletId returns 400", async () => {
    const res = await app.request("/api/v1/redemptions/create", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionToken}` },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});
