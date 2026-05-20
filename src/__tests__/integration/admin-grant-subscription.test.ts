import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../app.js";
import { db } from "../../db/index.js";
import { user, session, subscription, invite, inviteRedemption, authCredential, paymentTransaction } from "../../db/schema.js";
import { eq } from "drizzle-orm";

const ADMIN_EMAIL = `admin-grant-${Date.now()}@test.com`;
const ADMIN_PASS = "testpass123";
let adminUserId = "";
let adminSessionToken = "";

const MEMBER_PHONE = `+628${Date.now().toString().slice(-9)}`;
let memberUserId = "";
let memberSessionToken = "";

describe("POST /admin/members/:id/grant-subscription", () => {
  beforeAll(async () => {
    // Create admin user via merchant register + DB role promotion
    const adminRes = await app.request("/api/v1/auth/merchant/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Grant Admin", email: ADMIN_EMAIL, password: ADMIN_PASS }),
    });
    const adminBody = await adminRes.json();
    adminUserId = adminBody.data?.user?.id ?? adminBody.user?.id ?? "";

    if (adminUserId) {
      await db.update(user).set({ role: "admin" }).where(eq(user.id, adminUserId));
    }

    // Get admin session token
    const adminLogin = await app.request("/api/v1/auth/merchant/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASS }),
    });
    const adminLoginBody = await adminLogin.json();
    adminSessionToken = adminLoginBody.data?.token ?? adminLoginBody.data?.session?.token ?? "";

    // Create regular member user
    await app.request("/api/v1/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phoneNumber: MEMBER_PHONE }),
    });
    const memberVerify = await app.request("/api/v1/auth/verify-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phoneNumber: MEMBER_PHONE, code: "123456" }),
    });
    const memberBody = await memberVerify.json();
    memberSessionToken = memberBody.data?.token ?? memberBody.data?.session?.token ?? "";
    memberUserId = memberBody.data?.user?.id ?? "";
  });

  afterAll(async () => {
    for (const uid of [adminUserId, memberUserId]) {
      if (!uid) continue;
      await db.delete(paymentTransaction).where(eq(paymentTransaction.accountId, uid));
      await db.delete(inviteRedemption).where(eq(inviteRedemption.accountId, uid));
      await db.delete(invite).where(eq(invite.referrerId, uid));
      await db.delete(subscription).where(eq(subscription.accountId, uid));
      await db.delete(authCredential).where(eq(authCredential.userId, uid));
      await db.delete(session).where(eq(session.userId, uid));
      await db.delete(user).where(eq(user.id, uid));
    }
  });

  it("requires admin auth — returns 401 without token", async () => {
    const res = await app.request(`/api/v1/admin/members/${memberUserId}/grant-subscription`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan: "yearly_founders", reason: "Founding member" }),
    });
    expect(res.status).toBe(401);
  });

  it("requires admin role — returns 403 for regular member", async () => {
    const res = await app.request(`/api/v1/admin/members/${memberUserId}/grant-subscription`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${memberSessionToken}`,
      },
      body: JSON.stringify({ plan: "yearly_founders", reason: "Founding member" }),
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("returns 404 for non-existent user", async () => {
    const res = await app.request(`/api/v1/admin/members/nonexistent-user-id/grant-subscription`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminSessionToken}`,
      },
      body: JSON.stringify({ plan: "yearly_founders", reason: "VIP" }),
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("validates request body — rejects invalid plan", async () => {
    const res = await app.request(`/api/v1/admin/members/${memberUserId}/grant-subscription`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminSessionToken}`,
      },
      body: JSON.stringify({ plan: "invalid_plan", reason: "Test" }),
    });
    expect(res.status).toBe(400);
  });

  it("validates request body — rejects missing reason", async () => {
    const res = await app.request(`/api/v1/admin/members/${memberUserId}/grant-subscription`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminSessionToken}`,
      },
      body: JSON.stringify({ plan: "yearly_founders" }),
    });
    expect(res.status).toBe(400);
  });

  it("grants a yearly_founders subscription to a new user", async () => {
    const res = await app.request(`/api/v1/admin/members/${memberUserId}/grant-subscription`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminSessionToken}`,
      },
      body: JSON.stringify({ plan: "yearly_founders", reason: "Founding member grant" }),
    });
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.success).toBe(true);
    expect(body.data.subscription).toBeDefined();
    expect(body.data.subscription.accountId).toBe(memberUserId);
    expect(body.data.subscription.status).toBe("active");
    expect(body.data.subscription.plan).toBe("yearly_founders");
    expect(body.data.subscription.paymentMethod).toBe("admin_grant");
    expect(body.data.subscription.startDate).toBeTruthy();
    expect(body.data.subscription.endDate).toBeTruthy();
    expect(body.data.reason).toBe("Founding member grant");
  });

  it("queues a renewal when user already has an active subscription", async () => {
    // memberUserId already has yearly_founders from previous test
    const res = await app.request(`/api/v1/admin/members/${memberUserId}/grant-subscription`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminSessionToken}`,
      },
      body: JSON.stringify({ plan: "yearly_kol", reason: "KOL upgrade" }),
    });
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.success).toBe(true);
    expect(body.data.subscription.plan).toBe("yearly_kol");
    expect(body.data.subscription.status).toBe("active");
    expect(body.data.subscription.paymentMethod).toBe("admin_grant");

    // Verify: the new sub should have a start date equal to the first sub's end date
    // (renewal queuing). Check that there are now 2 active subscriptions.
    const subs = await db
      .select()
      .from(subscription)
      .where(eq(subscription.accountId, memberUserId));
    expect(subs.length).toBe(2);

    // The second sub should start when the first ends
    const sorted = subs.sort((a, b) =>
      new Date(a.startDate!).getTime() - new Date(b.startDate!).getTime()
    );
    expect(new Date(sorted[1].startDate!).getTime()).toBe(new Date(sorted[0].endDate!).getTime());
  });

  it("grants a monthly subscription", async () => {
    // Create a fresh user for monthly test
    const phone = `+628${Date.now().toString().slice(-8)}M`;
    await app.request("/api/v1/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phoneNumber: phone }),
    });
    const verify = await app.request("/api/v1/auth/verify-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phoneNumber: phone, code: "123456" }),
    });
    const vBody = await verify.json();
    const uid = vBody.data?.user?.id ?? "";

    const res = await app.request(`/api/v1/admin/members/${uid}/grant-subscription`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminSessionToken}`,
      },
      body: JSON.stringify({ plan: "monthly", reason: "Trial month" }),
    });
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.data.subscription.plan).toBe("monthly");
    expect(body.data.subscription.status).toBe("active");
    expect(body.data.subscription.paymentMethod).toBe("admin_grant");

    // Verify 30-day duration
    const start = new Date(body.data.subscription.startDate);
    const end = new Date(body.data.subscription.endDate);
    const diffDays = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
    expect(diffDays).toBe(30);

    // Cleanup
    if (uid) {
      await db.delete(subscription).where(eq(subscription.accountId, uid));
      await db.delete(session).where(eq(session.userId, uid));
      await db.delete(user).where(eq(user.id, uid));
    }
  });
});
