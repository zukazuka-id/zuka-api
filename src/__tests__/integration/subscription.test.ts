import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { app } from "../../app.js";
import { db } from "../../db/index.js";
import { user, session, subscription, invite, inviteRedemption, paymentTransaction } from "../../db/schema.js";
import { eq, and } from "drizzle-orm";
import { resetRateLimiterState } from "../../middleware/rate-limiter.js";

const TEST_PHONE = `+628${Date.now().toString().slice(-9)}`;
let sessionToken = "";
let userId = "";

async function setupTestUser() {
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
}

describe("Subscription Integration Tests", () => {
  afterAll(async () => {
    if (userId) {
      await db.delete(subscription).where(eq(subscription.accountId, userId));
      await db.delete(session).where(eq(session.userId, userId));
      await db.delete(user).where(eq(user.id, userId));
    }
  });

  it("requires auth — returns 401 without token", async () => {
    const res = await app.request("/api/v1/subscription/status");
    expect(res.status).toBe(401);
  });

  it("GET /subscription/status — no subscription returns hasSubscription false", async () => {
    await setupTestUser();
    const res = await app.request("/api/v1/subscription/status", {
      headers: { Authorization: `Bearer ${sessionToken}` },
    });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.hasSubscription).toBe(false);
  });

  it("POST /subscription/create — creates annual subscription", async () => {
    const res = await app.request("/api/v1/subscription/create", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionToken}` },
      body: JSON.stringify({ plan: "yearly" }),
    });
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.data.subscriptionId).toBeTruthy();
    expect(body.data.plan).toBe("yearly");
    expect(body.data.amount).toBe(990000);
  });

  it("POST /subscription/create — duplicate subscription returns 409", async () => {
    const res = await app.request("/api/v1/subscription/create", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionToken}` },
      body: JSON.stringify({ plan: "yearly" }),
    });
    expect(res.status).toBe(409);
  });

  it("GET /subscription/status — returns active subscription", async () => {
    const res = await app.request("/api/v1/subscription/status", {
      headers: { Authorization: `Bearer ${sessionToken}` },
    });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.hasSubscription).toBe(true);
    expect(body.data.plan).toBe("yearly");
    expect(body.data.daysRemaining).toBeGreaterThan(0);
  });

  it("POST /subscription/create — monthly plan", async () => {
    // Create a new user for monthly test
    const phone2 = `+628${Date.now().toString().slice(-8)}1`;
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

    const res = await app.request("/api/v1/subscription/create", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token2}` },
      body: JSON.stringify({ plan: "monthly" }),
    });
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.data.plan).toBe("monthly");
    expect(body.data.amount).toBe(99000);

    // Cleanup
    if (userId2) {
      await db.delete(subscription).where(eq(subscription.accountId, userId2));
      await db.delete(session).where(eq(session.userId, userId2));
      await db.delete(user).where(eq(user.id, userId2));
    }
  });
});

describe("Invite consuming during subscription/create", () => {
  const CONSUME_PHONE_REFERRER = `+628${Date.now().toString().slice(-8)}R`;
  let referrerToken = "";
  let referrerId = "";
  let freshUserId = "";
  let freshCode = "";

  afterAll(async () => {
    if (freshUserId) {
      await db.delete(inviteRedemption).where(eq(inviteRedemption.accountId, freshUserId));
      await db.delete(subscription).where(eq(subscription.accountId, freshUserId));
      await db.delete(session).where(eq(session.userId, freshUserId));
      await db.delete(user).where(eq(user.id, freshUserId));
    }
    if (referrerId) {
      await db.delete(invite).where(eq(invite.referrerId, referrerId));
      await db.delete(subscription).where(eq(subscription.accountId, referrerId));
      await db.delete(session).where(eq(session.userId, referrerId));
      await db.delete(user).where(eq(user.id, referrerId));
    }
  });

  it("subscription/create transitions claimed invite to consumed", async () => {
    // Create referrer with subscription
    await app.request("/api/v1/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phoneNumber: CONSUME_PHONE_REFERRER }),
    });
    const v1 = await app.request("/api/v1/auth/verify-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phoneNumber: CONSUME_PHONE_REFERRER, code: "123456" }),
    });
    const v1Body = await v1.json();
    referrerToken = v1Body.data?.token ?? v1Body.data?.session?.token ?? "";
    referrerId = v1Body.data?.user?.id ?? "";

    await app.request("/api/v1/subscription/create", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${referrerToken}` },
      body: JSON.stringify({ plan: "yearly" }),
    });

    // Generate invite code
    const gen = await app.request("/api/v1/invites/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${referrerToken}` },
      body: JSON.stringify({ count: 1 }),
    });
    freshCode = (await gen.json()).data[0].code;

    // Register new user with invite code (claims the invite)
    const freshPhone = `+628${Date.now().toString().slice(-8)}F`;
    await app.request("/api/v1/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phoneNumber: freshPhone }),
    });
    const v3 = await app.request("/api/v1/auth/verify-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phoneNumber: freshPhone, code: "123456", inviteCode: freshCode }),
    });
    const v3Body = await v3.json();
    const freshToken = v3Body.data?.token ?? v3Body.data?.session?.token ?? "";
    freshUserId = v3Body.data?.user?.id ?? "";

    // Verify invite is claimed
    const [before] = await db.select().from(inviteRedemption).where(eq(inviteRedemption.accountId, freshUserId)).limit(1);
    expect(before).toBeTruthy();
    expect(before.phase).toBe("claimed");

    // Create subscription — should auto-consume the invite
    const subRes = await app.request("/api/v1/subscription/create", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${freshToken}` },
      body: JSON.stringify({ plan: "yearly" }),
    });
    expect(subRes.status).toBe(201);

    // Verify invite is now consumed
    const [after] = await db.select().from(inviteRedemption).where(eq(inviteRedemption.accountId, freshUserId)).limit(1);
    expect(after.phase).toBe("consumed");
    expect(after.consumedAt).toBeTruthy();
  });
});

// ============================================================
// Payment Intents Integration Tests
// ============================================================

describe("POST /subscription/payment-intents", () => {
  const PI_PHONE = `+628${Date.now().toString().slice(-8)}PI`;
  let piToken = "";
  let piUserId = "";

  beforeAll(async () => {
    resetRateLimiterState();
    // Set fake payment provider mode for all tests
    process.env.PAYMENT_PROVIDER_MODE = "fake";

    // Register and verify a test user
    await app.request("/api/v1/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phoneNumber: PI_PHONE }),
    });
    const verify = await app.request("/api/v1/auth/verify-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phoneNumber: PI_PHONE, code: "123456" }),
    });
    const body = await verify.json();
    piToken = body.data?.token ?? body.data?.session?.token ?? "";
    piUserId = body.data?.user?.id ?? "";
  });

  afterAll(async () => {
    if (piUserId) {
      await db.delete(paymentTransaction).where(eq(paymentTransaction.accountId, piUserId));
      await db.delete(subscription).where(eq(subscription.accountId, piUserId));
      await db.delete(inviteRedemption).where(eq(inviteRedemption.accountId, piUserId));
      await db.delete(session).where(eq(session.userId, piUserId));
      await db.delete(user).where(eq(user.id, piUserId));
    }
    delete process.env.PAYMENT_PROVIDER_MODE;
  });

  it("requires auth — returns 401 without token", async () => {
    const res = await app.request("/api/v1/subscription/payment-intents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan: "monthly" }),
    });
    expect(res.status).toBe(401);
  });

  it("validates plan — rejects invalid plan value", async () => {
    const res = await app.request("/api/v1/subscription/payment-intents", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${piToken}` },
      body: JSON.stringify({ plan: "invalid_plan" }),
    });
    expect(res.status).toBe(400);
  });

  it("defaults plan to 'yearly' when not provided", async () => {
    const res = await app.request("/api/v1/subscription/payment-intents", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${piToken}` },
      body: JSON.stringify({}),
    });
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.data.orderId).toMatch(/^ZUKA-\d{8}-/);
    expect(body.data.amount).toBe(475000);
    expect(body.data.currency).toBe("IDR");
    expect(body.data.status).toBe("pending");
    expect(body.data.qrisPayload).toBeTruthy();
    expect(body.data.expiresAt).toBeTruthy();
    expect(body.data.timeoutInSeconds).toBe(1800);
  });

  it("creates pending payment for monthly plan (paid)", async () => {
    resetRateLimiterState();
    // Need a fresh user since the previous test already has a payment
    const phone = `+628${Date.now().toString().slice(-8)}M1`;
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
    const token = vBody.data?.token ?? vBody.data?.session?.token ?? "";
    const uid = vBody.data?.user?.id ?? "";

    const res = await app.request("/api/v1/subscription/payment-intents", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ plan: "monthly" }),
    });
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.data.paymentId).toBeTruthy();
    expect(body.data.orderId).toMatch(/^ZUKA-\d{8}-/);
    expect(body.data.providerReference).toBeTruthy();
    expect(body.data.amount).toBe(49000);
    expect(body.data.currency).toBe("IDR");
    expect(body.data.status).toBe("pending");
    expect(body.data.qrisPayload).toBeTruthy();
    expect(body.data.timeoutInSeconds).toBe(1800);

    // Cleanup
    if (uid) {
      await db.delete(paymentTransaction).where(eq(paymentTransaction.accountId, uid));
      await db.delete(subscription).where(eq(subscription.accountId, uid));
      await db.delete(session).where(eq(session.userId, uid));
      await db.delete(user).where(eq(user.id, uid));
    }
  });

  it("creates pending payment for yearly plan (paid)", async () => {
    resetRateLimiterState();
    // The user from beforeAll (piUserId) already has a yearly pending payment from the default test
    // So we reuse: calling again should return the existing pending payment
    const res = await app.request("/api/v1/subscription/payment-intents", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${piToken}` },
      body: JSON.stringify({ plan: "yearly" }),
    });
    const body = await res.json();
    // Should reuse the pending payment from the defaults test
    expect(res.status).toBe(200);
    expect(body.data.status).toBe("pending");
    expect(body.data.amount).toBe(475000);
  });

  it("reuses pending non-expired payment for same user+plan", async () => {
    resetRateLimiterState();
    // Call again for yearly — should get back the same pending payment
    const first = await app.request("/api/v1/subscription/payment-intents", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${piToken}` },
      body: JSON.stringify({ plan: "yearly" }),
    });
    const firstBody = await first.json();
    expect(first.status).toBe(200);

    const second = await app.request("/api/v1/subscription/payment-intents", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${piToken}` },
      body: JSON.stringify({ plan: "yearly" }),
    });
    const secondBody = await second.json();
    expect(second.status).toBe(200);
    // Both should return the same payment
    expect(secondBody.data.paymentId).toBe(firstBody.data.paymentId);
    expect(secondBody.data.orderId).toBe(firstBody.data.orderId);
  });

  it("free plan (yearly_kol) directly activates subscription", async () => {
    resetRateLimiterState();
    const res = await app.request("/api/v1/subscription/payment-intents", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${piToken}` },
      body: JSON.stringify({ plan: "yearly_kol" }),
    });
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.data.subscription).toBeTruthy();
    expect(body.data.subscription.plan).toBe("yearly_kol");
    expect(body.data.subscription.status).toBe("active");
    expect(body.data.subscription.paymentMethod).toBe("free:yearly_kol");
    expect(body.data.subscription.startDate).toBeTruthy();
    expect(body.data.subscription.endDate).toBeTruthy();
    // Should NOT have QRIS payload
    expect(body.data.qrisPayload).toBeUndefined();
  });

  it("free plan (yearly_founders) directly activates subscription", async () => {
    resetRateLimiterState();
    // Need fresh user since piUserId already has active subscription from yearly_kol
    const phone = `+628${Date.now().toString().slice(-8)}F1`;
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
    const token = vBody.data?.token ?? vBody.data?.session?.token ?? "";
    const uid = vBody.data?.user?.id ?? "";

    const res = await app.request("/api/v1/subscription/payment-intents", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ plan: "yearly_founders" }),
    });
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.data.subscription.plan).toBe("yearly_founders");
    expect(body.data.subscription.status).toBe("active");
    expect(body.data.subscription.paymentMethod).toBe("free:yearly_founders");

    // Verify payment_transaction was created with paid status
    const [payment] = await db
      .select()
      .from(paymentTransaction)
      .where(eq(paymentTransaction.accountId, uid))
      .limit(1);
    expect(payment).toBeTruthy();
    expect(payment.status).toBe("paid");
    expect(payment.amount).toBe(0);

    // Cleanup
    if (uid) {
      await db.delete(paymentTransaction).where(eq(paymentTransaction.accountId, uid));
      await db.delete(subscription).where(eq(subscription.accountId, uid));
      await db.delete(session).where(eq(session.userId, uid));
      await db.delete(user).where(eq(user.id, uid));
    }
  });

  it("free plan queues renewal when active subscription exists", async () => {
    resetRateLimiterState();
    // piUserId already has yearly_kol active from previous test
    // Requesting yearly_founders should queue the subscription
    const res = await app.request("/api/v1/subscription/payment-intents", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${piToken}` },
      body: JSON.stringify({ plan: "yearly_founders" }),
    });
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.data.subscription.status).toBe("active");
    // The end date should be ~730 days from now (365 + 365, stacked)
    const endDate = new Date(body.data.subscription.endDate);
    const now = new Date();
    const daysDiff = Math.round((endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    expect(daysDiff).toBeGreaterThan(600); // Should be roughly 730 days out
  });

  it("records payment_transaction in DB for paid plans", async () => {
    resetRateLimiterState();
    // Check the payment record exists for piUserId's yearly plan
    const [payment] = await db
      .select()
      .from(paymentTransaction)
      .where(
        and(
          eq(paymentTransaction.accountId, piUserId),
          eq(paymentTransaction.plan, "yearly"),
        ),
      )
      .limit(1);

    expect(payment).toBeTruthy();
    expect(payment.orderId).toMatch(/^ZUKA-\d{8}-/);
    expect(payment.provider).toBe("yukk");
    expect(payment.method).toBe("qris");
    expect(payment.amount).toBe(475000);
    expect(payment.status).toBe("pending");
    expect(payment.providerReference).toBeTruthy();
    expect(payment.qrisPayload).toBeTruthy();
  });
});
