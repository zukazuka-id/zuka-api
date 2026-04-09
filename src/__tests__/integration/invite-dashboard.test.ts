import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { app } from "../../app.js";
import { db } from "../../db/index.js";
import { user, session, subscription, invite, inviteRedemption } from "../../db/schema.js";
import { eq } from "drizzle-orm";
import { resetRateLimiterState } from "../../middleware/rate-limiter.js";

const TEST_PHONE = `+628${Date.now().toString().slice(-9)}`;
let sessionToken = "";
let userId = "";

async function setupUserWithSubscription() {
  const reg = await app.request("/api/v1/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phoneNumber: TEST_PHONE }),
  });
  expect(reg.status).toBe(200);

  const verify = await app.request("/api/v1/auth/verify-otp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phoneNumber: TEST_PHONE, code: "123456" }),
  });
  const body = await verify.json();
  expect(verify.status).toBe(200);
  sessionToken = body.data?.token ?? body.data?.session?.token ?? "";
  userId = body.data?.user?.id ?? "";

  await app.request("/api/v1/subscription/create", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionToken}` },
    body: JSON.stringify({ plan: "yearly" }),
  });
}

describe("Invite Dashboard Integration Tests", () => {
  beforeEach(() => {
    resetRateLimiterState();
  });

  afterAll(async () => {
    if (userId) {
      await db.delete(inviteRedemption).where(eq(inviteRedemption.accountId, userId));
      await db.delete(invite).where(eq(invite.referrerId, userId));
      await db.delete(subscription).where(eq(subscription.accountId, userId));
      await db.delete(session).where(eq(session.userId, userId));
      await db.delete(user).where(eq(user.id, userId));
    }
  });

  it("GET /invites/dashboard — returns 401 without auth", async () => {
    const res = await app.request("/api/v1/invites/dashboard");
    expect(res.status).toBe(401);
  });

  it("GET /invites/dashboard — returns empty dashboard for new user", async () => {
    await setupUserWithSubscription();

    const res = await app.request("/api/v1/invites/dashboard", {
      headers: { Authorization: `Bearer ${sessionToken}` },
    });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);

    // Codes should be empty
    expect(Array.isArray(body.data.codes)).toBe(true);
    expect(body.data.codes.length).toBe(0);

    // Stats should all be 0
    expect(body.data.stats.totalCodes).toBe(0);
    expect(body.data.stats.claimed).toBe(0);
    expect(body.data.stats.consumed).toBe(0);

    // Quota should have defaults from platform_config
    expect(body.data.quota.usedToday).toBe(0);
    expect(typeof body.data.quota.limit).toBe("number");
    expect(body.data.quota.limit).toBeGreaterThanOrEqual(1);
    expect(body.data.quota.resetsAt).toBeTruthy();
  });

  it("GET /invites/dashboard — returns codes after generating", async () => {
    // Generate 3 invite codes
    const genRes = await app.request("/api/v1/invites/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionToken}` },
      body: JSON.stringify({ count: 3 }),
    });
    expect(genRes.status).toBe(201);

    const dashRes = await app.request("/api/v1/invites/dashboard", {
      headers: { Authorization: `Bearer ${sessionToken}` },
    });
    const body = await dashRes.json();
    expect(dashRes.status).toBe(200);
    expect(body.success).toBe(true);

    // Should have 3 codes
    expect(body.data.codes.length).toBe(3);
    expect(body.data.stats.totalCodes).toBe(3);

    // Quota should reflect usage
    expect(body.data.quota.usedToday).toBe(3);
  });
});
