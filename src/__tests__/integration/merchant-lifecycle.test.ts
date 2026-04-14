import { describe, it, expect, afterAll } from "vitest";
import { app } from "../../app.js";
import { db } from "../../db/index.js";
import { accountRole, outlet, restaurant, session, user } from "../../db/schema.js";
import { eq } from "drizzle-orm";

type MerchantFixture = {
  userId: string;
  sessionToken: string;
  restaurantId: string;
  outletId: string;
};

const createdFixtures: MerchantFixture[] = [];

async function createMerchantFixture(options: {
  restaurantStatus: "pending" | "active" | "suspended" | "archived";
  outletStatus: "pending" | "active" | "suspended" | "archived";
}): Promise<MerchantFixture> {
  const userId = crypto.randomUUID();
  const sessionToken = crypto.randomUUID();
  const restaurantId = crypto.randomUUID();
  const outletId = crypto.randomUUID();

  await db.insert(user).values({
    id: userId,
    name: `Merchant ${Date.now()}`,
    email: `merchant-${Date.now()}@test.com`,
    role: "user",
    emailVerified: true,
  });

  await db.insert(session).values({
    id: crypto.randomUUID(),
    userId,
    token: sessionToken,
    expiresAt: new Date(Date.now() + 1000 * 60 * 60),
  });

  await db.insert(restaurant).values({
    id: restaurantId,
    name: `Merchant Restaurant ${Date.now()}`,
    status: options.restaurantStatus,
  });

  await db.insert(outlet).values({
    id: outletId,
    restaurantId,
    label: `Merchant Outlet ${Date.now()}`,
    address: "Jl. Merchant No. 1",
    status: options.outletStatus,
    isOpen: options.outletStatus === "active",
  });

  await db.insert(accountRole).values({
    accountId: userId,
    outletId,
    role: "owner",
  });

  const fixture = { userId, sessionToken, restaurantId, outletId };
  createdFixtures.push(fixture);
  return fixture;
}

afterAll(async () => {
  for (const fixture of createdFixtures) {
    await db.delete(accountRole).where(eq(accountRole.accountId, fixture.userId));
    await db.delete(session).where(eq(session.userId, fixture.userId));
    await db.delete(outlet).where(eq(outlet.id, fixture.outletId));
    await db.delete(restaurant).where(eq(restaurant.id, fixture.restaurantId));
    await db.delete(user).where(eq(user.id, fixture.userId));
  }
});

describe("Merchant Lifecycle Integration Tests", () => {
  it("GET /merchant/outlet/:id — suspended outlet remains readable but PUT returns lifecycle-specific 403", async () => {
    const fixture = await createMerchantFixture({
      restaurantStatus: "active",
      outletStatus: "suspended",
    });

    const readRes = await app.request(`/api/v1/merchant/outlet/${fixture.outletId}`, {
      headers: { Authorization: `Bearer ${fixture.sessionToken}` },
    });
    expect(readRes.status).toBe(200);

    const writeRes = await app.request(`/api/v1/merchant/outlet/${fixture.outletId}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${fixture.sessionToken}`,
      },
      body: JSON.stringify({
        label: "Suspended Outlet Updated",
      }),
    });

    expect(writeRes.status).toBe(403);
    const writeBody = await writeRes.json();
    expect(String(writeBody.error?.message ?? "").toLowerCase()).toContain("suspended");
  });

  it("PUT /merchant/outlet/:id — merchant cannot change outlet lifecycle status directly", async () => {
    const fixture = await createMerchantFixture({
      restaurantStatus: "active",
      outletStatus: "active",
    });

    const res = await app.request(`/api/v1/merchant/outlet/${fixture.outletId}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${fixture.sessionToken}`,
      },
      body: JSON.stringify({
        status: "suspended",
      }),
    });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(String(body.error?.message ?? "").toLowerCase()).toContain("lifecycle");
  });

  it("GET /merchant/restaurant/:id and /merchant/outlet/:id — archived context is inaccessible", async () => {
    const fixture = await createMerchantFixture({
      restaurantStatus: "archived",
      outletStatus: "archived",
    });

    const outletRes = await app.request(`/api/v1/merchant/outlet/${fixture.outletId}`, {
      headers: { Authorization: `Bearer ${fixture.sessionToken}` },
    });
    expect(outletRes.status).toBe(404);

    const restaurantRes = await app.request(`/api/v1/merchant/restaurant/${fixture.restaurantId}`, {
      headers: { Authorization: `Bearer ${fixture.sessionToken}` },
    });
    expect(restaurantRes.status).toBe(404);
  });
});
