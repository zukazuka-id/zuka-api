import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../app.js";
import { db } from "../../db/index.js";
import {
  user,
  session,
  authCredential,
  invite,
  inviteRedemption,
  subscription,
  outlet,
  restaurant,
  restaurantPhoto,
} from "../../db/schema.js";
import { and, eq, isNull } from "drizzle-orm";
import { computeOutletIsOpen } from "../../lib/outlet-availability.js";

const ADMIN_EMAIL = `admin-restaurants-${Date.now()}@test.com`;
const ADMIN_PASS = "testpass123";
let adminUserId = "";
let adminSessionToken = "";

const createdRestaurantIds: string[] = [];

async function createAdminToken() {
  const registerRes = await app.request("/api/v1/auth/merchant/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Admin Restaurants", email: ADMIN_EMAIL, password: ADMIN_PASS }),
  });
  const registerBody = await registerRes.json();
  adminUserId = registerBody.data?.user?.id ?? registerBody.user?.id ?? "";

  if (adminUserId) {
    await db.update(user).set({ role: "admin" }).where(eq(user.id, adminUserId));
  }

  const loginRes = await app.request("/api/v1/auth/merchant/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASS }),
  });
  const loginBody = await loginRes.json();
  adminSessionToken = loginBody.data?.token ?? loginBody.data?.session?.token ?? "";
}

async function cleanupRestaurant(id: string) {
  if (!id) return;
  await db
    .delete(restaurantPhoto)
    .where(and(eq(restaurantPhoto.restaurantId, id), isNull(restaurantPhoto.outletId)));
  await db.delete(restaurant).where(eq(restaurant.id, id));
}

describe("Admin Restaurants", () => {
  beforeAll(async () => {
    await createAdminToken();
  });

  afterAll(async () => {
    for (const id of createdRestaurantIds) {
      await cleanupRestaurant(id);
    }

    if (adminUserId) {
      await db.delete(inviteRedemption).where(eq(inviteRedemption.accountId, adminUserId));
      await db.delete(invite).where(eq(invite.referrerId, adminUserId));
      await db.delete(subscription).where(eq(subscription.accountId, adminUserId));
      await db.delete(authCredential).where(eq(authCredential.userId, adminUserId));
      await db.delete(session).where(eq(session.userId, adminUserId));
      await db.delete(user).where(eq(user.id, adminUserId));
    }
  });

  it("POST /admin/restaurants creates a restaurant and defaults to pending", async () => {
    const res = await app.request("/api/v1/admin/restaurants", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminSessionToken}`,
      },
      body: JSON.stringify({
        name: "Task 2 Admin Create",
        description: "Created from the admin test",
        cuisineTags: ["Japanese", "Sushi"],
        halalCertified: true,
        operatingHours: { mon: ["10:00", "22:00"] },
        whatsappNumber: "+6281234567890",
        phoneNumber: "+622112345678",
        instagramHandle: "@task2admincreate",
        tiktokHandle: "@task2admincreate",
        facebookUrl: "https://facebook.com/task2admincreate",
        defaultBogoLimit: 3,
        defaultAvgTableSpend: 125000,
        photos: [
          {
            url: "https://example.com/photo-1.jpg",
            label: "Front",
            sortOrder: 1,
          },
        ],
      }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.id).toBeDefined();
    expect(body.data.name).toBe("Task 2 Admin Create");
    expect(body.data.status).toBe("pending");
    expect(body.data.defaultBogoLimit).toBe(3);
    expect(body.data.defaultAvgTableSpend).toBe(125000);
    createdRestaurantIds.push(body.data.id);

    const persistedPhotos = await db
      .select()
      .from(restaurantPhoto)
      .where(and(eq(restaurantPhoto.restaurantId, body.data.id), isNull(restaurantPhoto.outletId)));

    expect(persistedPhotos).toHaveLength(1);
    expect(persistedPhotos[0]?.url).toBe("https://example.com/photo-1.jpg");
    expect(persistedPhotos[0]?.label).toBe("Front");
    expect(persistedPhotos[0]?.sortOrder).toBe(1);
  });

  it("GET /admin/restaurants filters by restaurantStatus, halal, and excludes archived by default", async () => {
    const activeRestaurant = await db
      .insert(restaurant)
      .values({
        name: "Admin List Active",
        status: "active",
        halalCertified: true,
        cuisineTags: ["Indonesian"],
      })
      .returning();
    const suspendedRestaurant = await db
      .insert(restaurant)
      .values({
        name: "Admin List Suspended",
        status: "suspended",
        halalCertified: false,
        cuisineTags: ["Chinese"],
      })
      .returning();
    const archivedRestaurant = await db
      .insert(restaurant)
      .values({
        name: "Admin List Archived",
        status: "archived",
        halalCertified: true,
        cuisineTags: ["Bakery"],
      })
      .returning();

    createdRestaurantIds.push(activeRestaurant[0].id, suspendedRestaurant[0].id, archivedRestaurant[0].id);

    const activeRes = await app.request("/api/v1/admin/restaurants?restaurantStatus=active", {
      headers: { Authorization: `Bearer ${adminSessionToken}` },
    });
    expect(activeRes.status).toBe(200);
    const activeBody = await activeRes.json();
    expect(activeBody.data.restaurants.every((row: { status?: string }) => row.status === "active")).toBe(true);
    expect(activeBody.data.restaurants.some((row: { id: string }) => row.id === suspendedRestaurant[0].id)).toBe(false);
    expect(activeBody.data.restaurants.some((row: { id: string }) => row.id === archivedRestaurant[0].id)).toBe(false);

    const halalRes = await app.request("/api/v1/admin/restaurants?halal=true", {
      headers: { Authorization: `Bearer ${adminSessionToken}` },
    });
    expect(halalRes.status).toBe(200);
    const halalBody = await halalRes.json();
    expect(halalBody.data.restaurants.every((row: { halalCertified?: boolean }) => row.halalCertified === true)).toBe(true);
    expect(halalBody.data.restaurants.some((row: { id: string }) => row.id === suspendedRestaurant[0].id)).toBe(false);
    expect(halalBody.data.restaurants.some((row: { id: string }) => row.id === archivedRestaurant[0].id)).toBe(false);

    const defaultRes = await app.request("/api/v1/admin/restaurants", {
      headers: { Authorization: `Bearer ${adminSessionToken}` },
    });
    expect(defaultRes.status).toBe(200);
    const defaultBody = await defaultRes.json();
    expect(defaultBody.data.restaurants.some((row: { id: string }) => row.id === archivedRestaurant[0].id)).toBe(false);

    const includeArchivedRes = await app.request("/api/v1/admin/restaurants?includeArchived=true", {
      headers: { Authorization: `Bearer ${adminSessionToken}` },
    });
    expect(includeArchivedRes.status).toBe(200);
    const includeArchivedBody = await includeArchivedRes.json();
    expect(includeArchivedBody.data.restaurants.some((row: { id: string }) => row.id === archivedRestaurant[0].id)).toBe(true);
  });

  it("GET /admin/restaurants/cuisine-tags returns unique tags", async () => {
    const tagRestaurants = await db
      .insert(restaurant)
      .values([
        {
          name: "Cuisine Tags One",
          cuisineTags: ["Ramen", "Japanese", "Ramen"],
        },
        {
          name: "Cuisine Tags Two",
          cuisineTags: ["Sushi", "Japanese"],
        },
      ])
      .returning();
    createdRestaurantIds.push(...tagRestaurants.map((row) => row.id));

    const res = await app.request("/api/v1/admin/restaurants/cuisine-tags", {
      headers: { Authorization: `Bearer ${adminSessionToken}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(new Set(body.data.tags)).toEqual(new Set(["Ramen", "Japanese", "Sushi"]));
  });

  it("PUT /admin/restaurants/:id updates supported fields", async () => {
    const [created] = await db
      .insert(restaurant)
      .values({
        name: "Admin Update Target",
        cuisineTags: ["Original"],
      })
      .returning();
    createdRestaurantIds.push(created.id);
    await db.insert(restaurantPhoto).values({
      restaurantId: created.id,
      outletId: null,
      url: "https://example.com/original.jpg",
      label: "Original",
      sortOrder: 0,
    });

    const res = await app.request(`/api/v1/admin/restaurants/${created.id}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminSessionToken}`,
      },
      body: JSON.stringify({
        name: "Admin Update Target v2",
        description: "Updated description",
        cuisineTags: ["Updated", "Kitchen"],
        halalCertified: true,
        operatingHours: { fri: ["11:00", "21:00"] },
        whatsappNumber: "+6281111111111",
        phoneNumber: "+622222222222",
        instagramHandle: "@updated",
        tiktokHandle: "@updated",
        facebookUrl: "https://facebook.com/updated",
        defaultBogoLimit: 5,
        defaultAvgTableSpend: 175000,
        photos: [{ url: "https://example.com/updated.jpg", label: "Updated" }],
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.name).toBe("Admin Update Target v2");
    expect(body.data.description).toBe("Updated description");
    expect(body.data.cuisineTags).toEqual(["Updated", "Kitchen"]);
    expect(body.data.halalCertified).toBe(true);
    expect(body.data.defaultBogoLimit).toBe(5);
    expect(body.data.defaultAvgTableSpend).toBe(175000);

    const persistedPhotos = await db
      .select()
      .from(restaurantPhoto)
      .where(and(eq(restaurantPhoto.restaurantId, created.id), isNull(restaurantPhoto.outletId)));

    expect(persistedPhotos).toHaveLength(1);
    expect(persistedPhotos[0]?.url).toBe("https://example.com/updated.jpg");
    expect(persistedPhotos[0]?.label).toBe("Updated");
  });

  it("POST /admin/restaurants/:id lifecycle endpoints update restaurant status and child outlets", async () => {
    const restaurantId = crypto.randomUUID();
    const openOutletId = crypto.randomUUID();
    const manuallyClosedOutletId = crypto.randomUUID();

    await db.insert(restaurant).values({
      id: restaurantId,
      name: "Lifecycle Target",
      status: "suspended",
    });

    await db.insert(outlet).values([
      {
        id: openOutletId,
        restaurantId,
        label: "Lifecycle Open Outlet",
        address: "Jl. Lifecycle No. 1",
        status: "active",
        isOpen: false,
      },
      {
        id: manuallyClosedOutletId,
        restaurantId,
        label: "Lifecycle Manual Close Outlet",
        address: "Jl. Lifecycle No. 2",
        status: "active",
        isOpen: false,
        isManuallyClosed: true,
        manualCloseReopenStrategy: "indefinite",
      },
    ]);

    createdRestaurantIds.push(restaurantId);

    const activateRes = await app.request(`/api/v1/admin/restaurants/${restaurantId}/activate`, {
      method: "POST",
      headers: { Authorization: `Bearer ${adminSessionToken}` },
    });

    expect(activateRes.status).toBe(200);
    const activateBody = await activateRes.json();
    expect(activateBody.data.status).toBe("active");

    const outletsAfterActivate = await db
      .select()
      .from(outlet)
      .where(eq(outlet.restaurantId, restaurantId));

    const openOutletAfterActivate = outletsAfterActivate.find((row) => row.id === openOutletId);
    const manuallyClosedOutletAfterActivate = outletsAfterActivate.find((row) => row.id === manuallyClosedOutletId);

    expect(openOutletAfterActivate?.status).toBe("active");
    expect(manuallyClosedOutletAfterActivate?.status).toBe("active");
    expect(openOutletAfterActivate?.isOpen).toBe(
      computeOutletIsOpen({
        outlet: {
          status: "active",
          operatingHours: null,
          isManuallyClosed: false,
          manualCloseReopenStrategy: "indefinite",
          manualCloseReopenAt: null,
        },
        restaurant: {
          status: "active",
        },
      })
    );
    expect(manuallyClosedOutletAfterActivate?.isOpen).toBe(
      computeOutletIsOpen({
        outlet: {
          status: "active",
          operatingHours: null,
          isManuallyClosed: true,
          manualCloseReopenStrategy: "indefinite",
          manualCloseReopenAt: null,
        },
        restaurant: {
          status: "active",
        },
      })
    );

    const suspendRes = await app.request(`/api/v1/admin/restaurants/${restaurantId}/suspend`, {
      method: "POST",
      headers: { Authorization: `Bearer ${adminSessionToken}` },
    });

    expect(suspendRes.status).toBe(200);
    const suspendBody = await suspendRes.json();
    expect(suspendBody.data.status).toBe("suspended");

    const outletsAfterSuspend = await db
      .select()
      .from(outlet)
      .where(eq(outlet.restaurantId, restaurantId));

    expect(outletsAfterSuspend.every((row) => row.isOpen === false)).toBe(true);
    expect(outletsAfterSuspend.every((row) => row.status === "active")).toBe(true);

    const archiveRes = await app.request(`/api/v1/admin/restaurants/${restaurantId}/archive`, {
      method: "POST",
      headers: { Authorization: `Bearer ${adminSessionToken}` },
    });

    expect(archiveRes.status).toBe(200);
    const archiveBody = await archiveRes.json();
    expect(archiveBody.data.status).toBe("archived");

    const outletsAfterArchive = await db
      .select()
      .from(outlet)
      .where(eq(outlet.restaurantId, restaurantId));

    expect(outletsAfterArchive.every((row) => row.isOpen === false)).toBe(true);
    expect(outletsAfterArchive.every((row) => row.status === "active")).toBe(true);
  });

  it("POST /admin/restaurants/:id/activate returns 404 when the restaurant is missing", async () => {
    const res = await app.request(`/api/v1/admin/restaurants/${crypto.randomUUID()}/activate`, {
      method: "POST",
      headers: { Authorization: `Bearer ${adminSessionToken}` },
    });

    expect(res.status).toBe(404);
  });

  it("blocks archived restaurant mutations in admin", async () => {
    const restaurantId = crypto.randomUUID();
    createdRestaurantIds.push(restaurantId);

    await db.insert(restaurant).values({
      id: restaurantId,
      name: "Archived Read Only",
      status: "archived",
    });

    const updateRes = await app.request(`/api/v1/admin/restaurants/${restaurantId}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminSessionToken}`,
      },
      body: JSON.stringify({
        description: "Should not persist",
      }),
    });
    expect(updateRes.status).toBe(403);

    const activateRes = await app.request(`/api/v1/admin/restaurants/${restaurantId}/activate`, {
      method: "POST",
      headers: { Authorization: `Bearer ${adminSessionToken}` },
    });
    expect(activateRes.status).toBe(403);

    const createOutletRes = await app.request(`/api/v1/admin/restaurants/${restaurantId}/outlets`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminSessionToken}`,
      },
      body: JSON.stringify({
        label: "Should Fail",
        address: "Jl. Archived No. 1",
      }),
    });
    expect(createOutletRes.status).toBe(403);
  });
});
