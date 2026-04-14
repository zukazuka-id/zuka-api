import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../app.js";
import { db } from "../../db/index.js";
import {
  user,
  session,
  restaurant,
  outlet,
  restaurantPhoto,
} from "../../db/schema.js";
import { and, eq, isNull } from "drizzle-orm";

const adminUserId = crypto.randomUUID();
const adminSessionToken = crypto.randomUUID();
const adminEmail = `admin-outlets-${Date.now()}@test.com`;

const createdRestaurantIds: string[] = [];
const createdOutletIds: string[] = [];

async function createAdminSession() {
  await db.insert(user).values({
    id: adminUserId,
    name: "Admin Outlets",
    email: adminEmail,
    role: "admin",
    emailVerified: true,
  });

  await db.insert(session).values({
    id: crypto.randomUUID(),
    userId: adminUserId,
    token: adminSessionToken,
    expiresAt: new Date(Date.now() + 1000 * 60 * 60),
  });
}

async function createRestaurantFixture(overrides: Partial<typeof restaurant.$inferInsert> = {}) {
  const [row] = await db
    .insert(restaurant)
    .values({
      name: `Outlet Parent ${Date.now()}`,
      status: "active",
      operatingHours: { mon: ["10:00", "22:00"] },
      defaultBogoLimit: 4,
      defaultAvgTableSpend: 125000,
      ...overrides,
    })
    .returning();

  createdRestaurantIds.push(row.id);
  return row;
}

async function cleanupRestaurant(id: string) {
  if (!id) return;
  await db.delete(restaurant).where(eq(restaurant.id, id));
}

describe("Admin Outlets", () => {
  beforeAll(async () => {
    await createAdminSession();
  });

  afterAll(async () => {
    for (const id of createdOutletIds) {
      await db.delete(outlet).where(eq(outlet.id, id));
    }

    for (const id of createdRestaurantIds) {
      await cleanupRestaurant(id);
    }

    await db.delete(session).where(eq(session.userId, adminUserId));
    await db.delete(user).where(eq(user.id, adminUserId));
  });

  it("POST /admin/restaurants/:restaurantId/outlets inherits defaults and persists outlet photos", async () => {
    const parent = await createRestaurantFixture({
      defaultBogoLimit: 6,
      defaultAvgTableSpend: 210000,
      operatingHours: { tue: ["11:00", "21:00"] },
    });

    const res = await app.request(`/api/v1/admin/restaurants/${parent.id}/outlets`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminSessionToken}`,
      },
      body: JSON.stringify({
        label: "Task 3 Outlet",
        address: "Jl. Example No. 1",
        lat: -6.2,
        lng: 106.8,
        photos: [
          {
            url: "https://example.com/outlet-1.jpg",
            label: "Front",
            imagekitFileId: "file-1",
            imagekitUrl: "https://ik.example.com/outlet-1.jpg",
            sortOrder: 2,
          },
        ],
      }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.id).toBeDefined();
    expect(body.data.status).toBe("pending");
    expect(body.data.isOpen).toBe(false);
    expect(body.data.operatingHours).toEqual({ tue: ["11:00", "21:00"] });
    expect(body.data.bogoLimit).toBe(6);
    expect(body.data.avgTableSpend).toBe(210000);

    createdOutletIds.push(body.data.id);

    const [persistedOutlet] = await db
      .select()
      .from(outlet)
      .where(eq(outlet.id, body.data.id))
      .limit(1);

    expect(persistedOutlet.operatingHours).toEqual({ tue: ["11:00", "21:00"] });
    expect(persistedOutlet.bogoLimit).toBe(6);
    expect(persistedOutlet.avgTableSpend).toBe(210000);
    expect(persistedOutlet.isOpen).toBe(false);

    const persistedPhotos = await db
      .select()
      .from(restaurantPhoto)
      .where(and(eq(restaurantPhoto.outletId, body.data.id), isNull(restaurantPhoto.restaurantId)));

    expect(persistedPhotos).toHaveLength(1);
    expect(persistedPhotos[0]?.url).toBe("https://example.com/outlet-1.jpg");
    expect(persistedPhotos[0]?.label).toBe("Front");
    expect(persistedPhotos[0]?.imagekitFileId).toBe("file-1");
    expect(persistedPhotos[0]?.imagekitUrl).toBe("https://ik.example.com/outlet-1.jpg");
    expect(persistedPhotos[0]?.sortOrder).toBe(2);
  });

  it("PUT /admin/outlets/:outletId updates outlet fields, forces closed archived state, and replaces photos", async () => {
    const parent = await createRestaurantFixture();
    const [created] = await db
      .insert(outlet)
      .values({
        restaurantId: parent.id,
        label: "Outlet Update Target",
        address: "Initial Address",
        status: "active",
        isOpen: true,
        bogoLimit: 2,
        avgTableSpend: 90000,
      })
      .returning();
    createdOutletIds.push(created.id);

    await db.insert(restaurantPhoto).values({
      outletId: created.id,
      restaurantId: null,
      url: "https://example.com/original-outlet.jpg",
      label: "Original",
      sortOrder: 0,
    });

    const res = await app.request(`/api/v1/admin/outlets/${created.id}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminSessionToken}`,
      },
      body: JSON.stringify({
        label: "Outlet Update Target v2",
        address: "Updated Address",
        bogoLimit: 5,
        avgTableSpend: 155000,
        status: "archived",
        isOpen: true,
        photos: [
          {
            url: "https://example.com/updated-outlet.jpg",
            label: "Updated",
            sortOrder: 4,
          },
        ],
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.label).toBe("Outlet Update Target v2");
    expect(body.data.address).toBe("Updated Address");
    expect(body.data.status).toBe("archived");
    expect(body.data.isOpen).toBe(false);
    expect(body.data.bogoLimit).toBe(5);
    expect(body.data.avgTableSpend).toBe(155000);

    const persistedPhotos = await db
      .select()
      .from(restaurantPhoto)
      .where(and(eq(restaurantPhoto.outletId, created.id), isNull(restaurantPhoto.restaurantId)));

    expect(persistedPhotos).toHaveLength(1);
    expect(persistedPhotos[0]?.url).toBe("https://example.com/updated-outlet.jpg");
    expect(persistedPhotos[0]?.label).toBe("Updated");
    expect(persistedPhotos[0]?.sortOrder).toBe(4);
  });

  it("GET /admin/outlets/:outletId returns outlet detail with photos", async () => {
    const parent = await createRestaurantFixture();
    const [created] = await db
      .insert(outlet)
      .values({
        restaurantId: parent.id,
        label: "Outlet Detail Target",
        address: "Detail Address",
        status: "active",
        isOpen: true,
      })
      .returning();
    createdOutletIds.push(created.id);

    await db.insert(restaurantPhoto).values({
      outletId: created.id,
      restaurantId: null,
      url: "https://example.com/detail-outlet.jpg",
      label: "Detail",
      sortOrder: 0,
    });

    const res = await app.request(`/api/v1/admin/outlets/${created.id}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${adminSessionToken}`,
      },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.id).toBe(created.id);
    expect(body.data.label).toBe("Outlet Detail Target");
    expect(body.data.photos).toHaveLength(1);
    expect(body.data.photos[0]?.url).toBe("https://example.com/detail-outlet.jpg");
  });

  it("POST /admin/outlets/:outletId activation and lifecycle actions update status and isOpen", async () => {
    const parent = await createRestaurantFixture();
    const [created] = await db
      .insert(outlet)
      .values({
        restaurantId: parent.id,
        label: "Lifecycle Outlet",
        address: "Lifecycle Address",
        status: "pending",
        isOpen: false,
        bogoLimit: 1,
        avgTableSpend: 80000,
      })
      .returning();
    createdOutletIds.push(created.id);

    const activateRes = await app.request(`/api/v1/admin/outlets/${created.id}/activate`, {
      method: "POST",
      headers: { Authorization: `Bearer ${adminSessionToken}` },
    });

    expect(activateRes.status).toBe(200);
    const activateBody = await activateRes.json();
    expect(activateBody.data.status).toBe("active");
    expect(activateBody.data.isOpen).toBe(true);

    const suspendRes = await app.request(`/api/v1/admin/outlets/${created.id}/suspend`, {
      method: "POST",
      headers: { Authorization: `Bearer ${adminSessionToken}` },
    });

    expect(suspendRes.status).toBe(200);
    const suspendBody = await suspendRes.json();
    expect(suspendBody.data.status).toBe("suspended");
    expect(suspendBody.data.isOpen).toBe(false);

    const archiveRes = await app.request(`/api/v1/admin/outlets/${created.id}/archive`, {
      method: "POST",
      headers: { Authorization: `Bearer ${adminSessionToken}` },
    });

    expect(archiveRes.status).toBe(200);
    const archiveBody = await archiveRes.json();
    expect(archiveBody.data.status).toBe("archived");
    expect(archiveBody.data.isOpen).toBe(false);
  });

  it("POST /admin/outlets/:outletId/close and /open manage manual close state", async () => {
    const parent = await createRestaurantFixture({
      operatingHours: { wed: ["10:00", "22:00"] },
    });
    const [created] = await db
      .insert(outlet)
      .values({
        restaurantId: parent.id,
        label: "Manual Close Outlet",
        address: "Manual Close Address",
        status: "active",
        isOpen: true,
        operatingHours: { wed: ["10:00", "22:00"] },
      })
      .returning();
    createdOutletIds.push(created.id);

    const closeRes = await app.request(`/api/v1/admin/outlets/${created.id}/close`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminSessionToken}`,
      },
      body: JSON.stringify({
        reopenStrategy: "custom",
        customReopenAt: "2026-04-13T10:30:00.000Z",
      }),
    });

    expect(closeRes.status).toBe(200);
    const closeBody = await closeRes.json();
    expect(closeBody.data.isManuallyClosed).toBe(true);
    expect(closeBody.data.isOpen).toBe(false);
    expect(closeBody.data.manualCloseReopenStrategy).toBe("custom");
    expect(closeBody.data.manualCloseReopenAt).toBeTruthy();

    const openRes = await app.request(`/api/v1/admin/outlets/${created.id}/open`, {
      method: "POST",
      headers: { Authorization: `Bearer ${adminSessionToken}` },
    });

    expect(openRes.status).toBe(200);
    const openBody = await openRes.json();
    expect(openBody.data.isManuallyClosed).toBe(false);
    expect(openBody.data.manualCloseReopenAt).toBeNull();
    expect(openBody.data.isOpen).toBe(true);
  });
});
