import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../app.js";
import { db } from "../../db/index.js";
import { user, session, verification, subscription, invite, inviteRedemption } from "../../db/schema.js";
import { eq } from "drizzle-orm";

const TEST_PHONE = `+628${Date.now().toString().slice(-9)}`;
let sessionToken = "";
let userId = "";

describe("Auth Integration Tests", () => {
  afterAll(async () => {
    // Cleanup test user and related data
    if (userId) {
      await db.delete(session).where(eq(session.userId, userId));
      await db.delete(subscription).where(eq(subscription.accountId, userId));
      await db.delete(user).where(eq(user.id, userId));
    }
  });

  it("POST /auth/register — sends OTP", async () => {
    const res = await app.request("/api/v1/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phoneNumber: TEST_PHONE }),
    });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
  });

  it("POST /auth/verify-otp — dev bypass with 123456 returns 200", async () => {
    const res = await app.request("/api/v1/auth/verify-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phoneNumber: TEST_PHONE, code: "123456" }),
    });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toBeDefined();

    const token = body.data?.token ?? body.data?.session?.token ?? "";
    expect(token).toBeTruthy();
    sessionToken = token;
    userId = body.data?.user?.id ?? "";
  });

  it("POST /auth/verify-otp — wrong code returns 400", async () => {
    const res = await app.request("/api/v1/auth/verify-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phoneNumber: TEST_PHONE, code: "000000" }),
    });
    expect(res.status).toBe(400);
  });

  it("POST /auth/verify-otp — missing fields returns 400", async () => {
    const res = await app.request("/api/v1/auth/verify-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("GET /auth/me — returns user info with valid session", async () => {
    const res = await app.request("/api/v1/auth/me", {
      headers: { Authorization: `Bearer ${sessionToken}` },
    });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.id).toBe(userId);
    expect(body.data.roles).toBeDefined();
  });

  it("GET /auth/me — returns 401 without token", async () => {
    const res = await app.request("/api/v1/auth/me");
    expect(res.status).toBe(401);
  });

  it("POST /auth/merchant/register — requires name, email, password", async () => {
    const res = await app.request("/api/v1/auth/merchant/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("POST /auth/merchant/login — invalid credentials returns error", async () => {
    const res = await app.request("/api/v1/auth/merchant/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "nobody@test.com", password: "wrong" }),
    });
    // Better Auth returns 401 or custom error for invalid credentials
    expect([400, 401, 422]).toContain(res.status);
  });
});

describe("Invite claiming during verify-otp", () => {
  const INVITE_PHONE = `+628${Date.now().toString().slice(-8)}9`;
  let inviteToken = "";
  let inviteUserId = "";
  let testCode = "";

  afterAll(async () => {
    if (inviteUserId) {
      await db.delete(inviteRedemption).where(eq(inviteRedemption.accountId, inviteUserId));
      await db.delete(invite).where(eq(invite.referrerId, inviteUserId));
      await db.delete(subscription).where(eq(subscription.accountId, inviteUserId));
      await db.delete(session).where(eq(session.userId, inviteUserId));
      await db.delete(user).where(eq(user.id, inviteUserId));
    }
  });

  it("setup: create referrer with subscription and generate invite code", async () => {
    await app.request("/api/v1/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phoneNumber: INVITE_PHONE }),
    });
    const v = await app.request("/api/v1/auth/verify-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phoneNumber: INVITE_PHONE, code: "123456" }),
    });
    const vBody = await v.json();
    inviteToken = vBody.data?.token ?? vBody.data?.session?.token ?? "";
    inviteUserId = vBody.data?.user?.id ?? "";

    await app.request("/api/v1/subscription/create", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${inviteToken}` },
      body: JSON.stringify({ plan: "yearly" }),
    });

    const gen = await app.request("/api/v1/invites/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${inviteToken}` },
      body: JSON.stringify({ count: 1 }),
    });
    const genBody = await gen.json();
    testCode = genBody.data[0].code;
    expect(testCode).toBeTruthy();
  });

  it("verify-otp with inviteCode creates user and claims invite", async () => {
    const newPhone = `+628${Date.now().toString().slice(-8)}X`;
    await app.request("/api/v1/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phoneNumber: newPhone }),
    });

    const res = await app.request("/api/v1/auth/verify-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phoneNumber: newPhone, code: "123456", inviteCode: testCode }),
    });
    const body = await res.json();
    expect(res.status).toBe(200);
    const newUserId = body.data?.user?.id ?? "";
    expect(newUserId).toBeTruthy();

    // Verify invite_redemption row exists with phase=claimed
    const [redemption] = await db
      .select()
      .from(inviteRedemption)
      .where(eq(inviteRedemption.accountId, newUserId))
      .limit(1);
    expect(redemption).toBeTruthy();
    expect(redemption.phase).toBe("claimed");

    // Cleanup
    await db.delete(inviteRedemption).where(eq(inviteRedemption.accountId, newUserId));
    await db.delete(session).where(eq(session.userId, newUserId));
    await db.delete(user).where(eq(user.id, newUserId));
  });

  it("verify-otp without inviteCode works normally (no invite claimed)", async () => {
    const newPhone = `+628${Date.now().toString().slice(-8)}Y`;
    await app.request("/api/v1/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phoneNumber: newPhone }),
    });

    const res = await app.request("/api/v1/auth/verify-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phoneNumber: newPhone, code: "123456" }),
    });
    expect(res.status).toBe(200);

    const newUserId = (await res.json()).data?.user?.id ?? "";
    const [redemption] = await db
      .select()
      .from(inviteRedemption)
      .where(eq(inviteRedemption.accountId, newUserId))
      .limit(1);
    expect(redemption).toBeUndefined();

    await db.delete(session).where(eq(session.userId, newUserId));
    await db.delete(user).where(eq(user.id, newUserId));
  });
});
