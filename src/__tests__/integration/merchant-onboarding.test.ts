import { describe, it, expect, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { app } from "../../app.js";
import { db } from "../../db/index.js";
import { accountRole, outlet, restaurant, session, user } from "../../db/schema.js";

type MerchantFixture = {
  userId: string;
  sessionToken: string;
  restaurantId: string;
  outletId: string;
};

const createdFixtures: MerchantFixture[] = [];

async function createMerchantFixture(): Promise<MerchantFixture> {
  const userId = crypto.randomUUID();
  const sessionToken = crypto.randomUUID();
  const restaurantId = crypto.randomUUID();
  const outletId = crypto.randomUUID();

  await db.insert(user).values({
    id: userId,
    name: `Merchant ${Date.now()}`,
    email: `merchant-onboarding-${Date.now()}@test.com`,
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
    name: "Merchant Onboarding Restaurant",
    status: "pending",
    defaultBogoLimit: 1,
  });

  await db.insert(outlet).values({
    id: outletId,
    restaurantId,
    label: "Merchant Onboarding Outlet",
    address: "Jl. Onboarding No. 1",
    status: "pending",
    isOpen: false,
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

describe("Merchant Onboarding Persistence", () => {
  it("PUT /merchant/restaurant/:id persists onboarding restaurant fields", async () => {
    const fixture = await createMerchantFixture();

    const res = await app.request(`/api/v1/merchant/restaurant/${fixture.restaurantId}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${fixture.sessionToken}`,
      },
      body: JSON.stringify({
        name: "Merchant Onboarding Restaurant v2",
        defaultBogoLimit: 4,
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.name).toBe("Merchant Onboarding Restaurant v2");
    expect(body.data.defaultBogoLimit).toBe(4);

    const [persisted] = await db
      .select({
        name: restaurant.name,
        defaultBogoLimit: restaurant.defaultBogoLimit,
      })
      .from(restaurant)
      .where(eq(restaurant.id, fixture.restaurantId))
      .limit(1);

    expect(persisted.name).toBe("Merchant Onboarding Restaurant v2");
    expect(persisted.defaultBogoLimit).toBe(4);
  });

  it("PUT /merchant/outlet/:id persists onboarding outlet fields", async () => {
    const fixture = await createMerchantFixture();

    const res = await app.request(`/api/v1/merchant/outlet/${fixture.outletId}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${fixture.sessionToken}`,
      },
      body: JSON.stringify({
        label: "Merchant Onboarding Outlet v2",
        address: "Jl. Onboarding No. 2",
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.label).toBe("Merchant Onboarding Outlet v2");
    expect(body.data.address).toBe("Jl. Onboarding No. 2");

    const [persisted] = await db
      .select({
        label: outlet.label,
        address: outlet.address,
      })
      .from(outlet)
      .where(eq(outlet.id, fixture.outletId))
      .limit(1);

    expect(persisted.label).toBe("Merchant Onboarding Outlet v2");
    expect(persisted.address).toBe("Jl. Onboarding No. 2");
  });
});
