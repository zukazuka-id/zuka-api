import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../app.js";
import { db } from "../../db/index.js";
import { user, session, subscription, invite, inviteRedemption, authCredential } from "../../db/schema.js";
import { eq } from "drizzle-orm";

const ADMIN_EMAIL = `admin-${Date.now()}@test.com`;
const ADMIN_PASS = "testpass123";
let adminUserId = "";
let adminSessionToken = "";
const MEMBER_PHONE = `+628${Date.now().toString().slice(-9)}`;
let memberUserId = "";
let memberSessionToken = "";

describe("Admin Auth Middleware", () => {
  beforeAll(async () => {
    // Create admin user via BetterAuth signUpEmail
    const adminRes = await app.request("/api/v1/auth/merchant/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Test Admin", email: ADMIN_EMAIL, password: ADMIN_PASS }),
    });
    const adminBody = await adminRes.json();
    adminUserId = adminBody.data?.user?.id ?? adminBody.user?.id ?? "";

    // Promote to admin via direct DB update
    if (adminUserId) {
      await db.update(user).set({ role: "admin" }).where(eq(user.id, adminUserId));
    }

    // Get admin session token via email login
    const adminLogin = await app.request("/api/v1/auth/merchant/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASS }),
    });
    const adminLoginBody = await adminLogin.json();
    adminSessionToken = adminLoginBody.data?.token ?? adminLoginBody.data?.session?.token ?? "";

    // Create regular member user via phone OTP
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
      await db.delete(inviteRedemption).where(eq(inviteRedemption.accountId, uid));
      await db.delete(invite).where(eq(invite.referrerId, uid));
      await db.delete(subscription).where(eq(subscription.accountId, uid));
      await db.delete(authCredential).where(eq(authCredential.userId, uid));
      await db.delete(session).where(eq(session.userId, uid));
      await db.delete(user).where(eq(user.id, uid));
    }
  });

  it("GET /admin/dashboard — no auth returns 401", async () => {
    const res = await app.request("/api/v1/admin/dashboard");
    expect(res.status).toBe(401);
  });

  it("GET /admin/dashboard — regular user returns 403", async () => {
    const res = await app.request("/api/v1/admin/dashboard", {
      headers: { Authorization: `Bearer ${memberSessionToken}` },
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("GET /admin/dashboard — admin user returns 200", async () => {
    const res = await app.request("/api/v1/admin/dashboard", {
      headers: { Authorization: `Bearer ${adminSessionToken}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.totalMembers).toBeDefined();
  });

  it("GET /admin/members — admin can list members", async () => {
    const res = await app.request("/api/v1/admin/members", {
      headers: { Authorization: `Bearer ${adminSessionToken}` },
    });
    expect(res.status).toBe(200);
  });

  it("GET /admin/members — member cannot access", async () => {
    const res = await app.request("/api/v1/admin/members", {
      headers: { Authorization: `Bearer ${memberSessionToken}` },
    });
    expect(res.status).toBe(403);
  });
});
