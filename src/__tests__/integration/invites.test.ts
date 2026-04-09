import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { app } from "../../app.js";
import { db } from "../../db/index.js";
import { user, session, subscription, invite, inviteRedemption } from "../../db/schema.js";
import { eq } from "drizzle-orm";
import { resetRateLimiterState } from "../../middleware/rate-limiter.js";

function generateInviteCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from(randomBytes(8)).map(b => chars[b % chars.length]).join("");
}

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
    body: JSON.stringify({ plan: "annual" }),
  });
}

describe("Invites Integration Tests", () => {
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

  it("POST /invites/generate — requires auth", async () => {
    const res = await app.request("/api/v1/invites/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ count: 1 }),
    });
    expect(res.status).toBe(401);
  });

  it("POST /invites/generate — requires active subscription", async () => {
    const phone2 = `+628${Date.now().toString().slice(-8)}2`;
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

    const res = await app.request("/api/v1/invites/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token2}` },
      body: JSON.stringify({ count: 1 }),
    });
    expect(res.status).toBe(403);

    if (userId2) {
      await db.delete(session).where(eq(session.userId, userId2));
      await db.delete(user).where(eq(user.id, userId2));
    }
  });

  it("POST /invites/generate — generates invite codes", async () => {
    await setupUserWithSubscription();
    const res = await app.request("/api/v1/invites/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionToken}` },
      body: JSON.stringify({ count: 3 }),
    });
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.data).toBeInstanceOf(Array);
    expect(body.data.length).toBe(3);
    expect(body.data[0].code).toBeTruthy();
    expect(body.data[0].code.length).toBe(8);
  });

  it("POST /invites/redeem — public, no auth required", async () => {
    const res = await app.request("/api/v1/invites/redeem", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "TESTCODE" }),
    });
    expect(res.status).toBe(404);
  });

  it("POST /invites/redeem — validates a valid code (no DB write)", async () => {
    const gen = await app.request("/api/v1/invites/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionToken}` },
      body: JSON.stringify({ count: 1 }),
    });
    const genBody = await gen.json();
    const code = genBody.data[0].code;

    const res = await app.request("/api/v1/invites/redeem", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.valid).toBe(true);
    expect(body.data.code).toBe(code);
    expect(body.data.type).toBe("single_use");

    // Verify code is still active (no DB write happened)
    const validateAgain = await app.request("/api/v1/invites/redeem", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    const againBody = await validateAgain.json();
    expect(validateAgain.status).toBe(200);
    expect(againBody.data.valid).toBe(true);
  });

  it("POST /invites/redeem — missing code returns 400", async () => {
    const res = await app.request("/api/v1/invites/redeem", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("POST /invites/redeem — multi_use code with limit rejects after limit reached", async () => {
    const code = generateInviteCode();

    const [inv] = await db.insert(invite).values({
      code,
      referrerId: userId,
      type: "multi_use",
      maxRedemptions: 1,
      status: "active",
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    }).returning();

    // First validation should succeed
    const res1 = await app.request("/api/v1/invites/redeem", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    expect(res1.status).toBe(200);

    // Claim the invite to increment redeemedCount
    await db.insert(inviteRedemption).values({
      inviteId: inv.id,
      accountId: userId,
      phase: "claimed",
      claimedAt: new Date(),
    });
    await db.update(invite).set({ redeemedCount: 1 }).where(eq(invite.id, inv.id));

    // Second validation should fail (limit reached)
    const res2 = await app.request("/api/v1/invites/redeem", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    expect(res2.status).toBe(409);
    const body2 = await res2.json();
    expect(body2.error.code).toBe("LIMIT_REACHED");
  });

  it("POST /invites/redeem — expired code returns 410", async () => {
    const code = generateInviteCode();

    await db.insert(invite).values({
      code,
      referrerId: userId,
      type: "single_use",
      status: "active",
      expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000), // yesterday
    });

    const res = await app.request("/api/v1/invites/redeem", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    expect(res.status).toBe(410);
    const body = await res.json();
    expect(body.error.code).toBe("EXPIRED");
  });

  it("deactivated invite returns 400, reactivated invite returns 200", async () => {
    // Generate an invite
    const genRes = await app.request("/api/v1/invites/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionToken}` },
      body: JSON.stringify({ count: 1 }),
    });
    const genBody = await genRes.json();
    const inviteId = genBody.data[0].id;
    const inviteCode = genBody.data[0].code;

    // Active invite should validate successfully
    const validRes = await app.request("/api/v1/invites/redeem", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: inviteCode }),
    });
    expect(validRes.status).toBe(200);

    // Deactivate via DB
    await db.update(invite).set({ status: "inactive" }).where(eq(invite.id, inviteId));

    const invalidRes = await app.request("/api/v1/invites/redeem", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: inviteCode }),
    });
    expect(invalidRes.status).toBe(400);

    // Reactivate via DB
    await db.update(invite).set({ status: "active" }).where(eq(invite.id, inviteId));

    const validRes2 = await app.request("/api/v1/invites/redeem", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: inviteCode }),
    });
    expect(validRes2.status).toBe(200);
  });

  it("duplicate invite claim is idempotent via onConflictDoNothing", async () => {
    const code = generateInviteCode();

    const [inv] = await db.insert(invite).values({
      code,
      referrerId: userId,
      type: "single_use",
      status: "active",
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    }).returning();

    // Insert redemption
    await db.insert(inviteRedemption).values({
      inviteId: inv.id,
      accountId: userId,
      phase: "claimed",
      claimedAt: new Date(),
    });
    await db.update(invite).set({ redeemedCount: 1 }).where(eq(invite.id, inv.id));

    // Try duplicate insert — should be no-op
    await db.insert(inviteRedemption).values({
      inviteId: inv.id,
      accountId: userId,
      phase: "claimed",
      claimedAt: new Date(),
    }).onConflictDoNothing();

    // Verify only one redemption exists
    const redemptions = await db.select().from(inviteRedemption).where(eq(inviteRedemption.inviteId, inv.id));
    expect(redemptions.length).toBe(1);
  });
});
