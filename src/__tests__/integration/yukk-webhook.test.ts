/**
 * Integration Tests: Yukk Webhook & B2B Access Token
 *
 * Tests the webhook flow end-to-end using PAYMENT_PROVIDER_MODE=fake
 * so signature verification is skipped.
 *
 * Coverage:
 * 1. B2B Access Token endpoint (POST /v1.0/access-token/b2b)
 * 2. Payment Notify webhook (POST /v1.0/qr/qr-mpm-notify)
 *    - Unknown order → 404
 *    - Invalid JSON → 400
 *    - Successful payment → marks paid + activates subscription
 *    - Idempotency: already-paid payment → 200 without re-activation
 *    - Pending status → 200 without activation
 *    - Amount mismatch → 400
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../app.js";
import { db } from "../../db/index.js";
import {
  user,
  session,
  subscription,
  paymentTransaction,
  inviteRedemption,
} from "../../db/schema.js";
import { eq } from "drizzle-orm";
import { resetRateLimiterState } from "../../middleware/rate-limiter.js";

// ---------------------------------------------------------------------------
// Test setup helpers
// ---------------------------------------------------------------------------

const TEST_PHONE = `+628${Date.now().toString().slice(-9)}W`;
let sessionToken = "";
let userId = "";
let paymentId = "";
let orderId = "";

async function setupTestUser() {
  await app.request("/api/v1/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phoneNumber: TEST_PHONE }),
  });

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

async function createPendingPayment(plan: string = "yearly") {
  const res = await app.request("/api/v1/subscription/payment-intents", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${sessionToken}`,
    },
    body: JSON.stringify({ plan }),
  });
  const body = await res.json();
  expect(res.status).toBe(201);
  paymentId = body.data.paymentId;
  orderId = body.data.orderId;
  return { paymentId, orderId };
}

// ---------------------------------------------------------------------------
// B2B Access Token Tests
// ---------------------------------------------------------------------------

describe("POST /v1.0/access-token/b2b — B2B Access Token", () => {
  beforeAll(() => {
    process.env.PAYMENT_PROVIDER_MODE = "fake";
    resetRateLimiterState();
  });

  afterAll(() => {
    delete process.env.PAYMENT_PROVIDER_MODE;
  });

  it("returns a valid B2B access token in fake mode", async () => {
    const res = await app.request("/v1.0/access-token/b2b", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CLIENT-KEY": "test-client-key",
        "X-SIGNATURE": "test-signature",
        "X-TIMESTAMP": new Date().toISOString(),
      },
      body: JSON.stringify({ grantType: "client_credentials" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.responseCode).toBe("2007300");
    expect(body.responseMessage).toBe("Successful");
    expect(body.accessToken).toBeTruthy();
    expect(body.tokenType).toBe("Bearer");
    expect(body.expiresIn).toBe("900");
  });

  it("returns a JWT that can be decoded", async () => {
    const res = await app.request("/v1.0/access-token/b2b", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CLIENT-KEY": "test-client-key",
        "X-SIGNATURE": "test-signature",
        "X-TIMESTAMP": new Date().toISOString(),
      },
      body: JSON.stringify({ grantType: "client_credentials" }),
    });

    const body = await res.json();
    const parts = body.accessToken.split(".");
    expect(parts).toHaveLength(3); // header.payload.signature

    // Decode payload
    const payload = JSON.parse(
      Buffer.from(parts[1], "base64url").toString(),
    );
    expect(payload.iss).toBe("zuka-api");
    expect(payload.aud).toBe("yukk-partner");
    expect(payload.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it("rejects request without required headers in non-fake mode", async () => {
    // Temporarily disable fake mode
    const prev = process.env.PAYMENT_PROVIDER_MODE;
    delete process.env.PAYMENT_PROVIDER_MODE;

    const res = await app.request("/v1.0/access-token/b2b", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ grantType: "client_credentials" }),
    });

    // Should fail — either unknown client or invalid timestamp
    expect(res.status).toBe(401);
    const body = await res.json();
    // Accepts either client key or timestamp rejection since both are missing
    expect(body.responseCode).toMatch(/^401730[123]$/);

    // Restore fake mode
    process.env.PAYMENT_PROVIDER_MODE = prev;
  });
});

// ---------------------------------------------------------------------------
// Payment Notify Webhook Tests
// ---------------------------------------------------------------------------

describe("POST /v1.0/qr/qr-mpm-notify — Payment Notification", () => {
  beforeAll(async () => {
    process.env.PAYMENT_PROVIDER_MODE = "fake";
    resetRateLimiterState();
    await setupTestUser();
    await createPendingPayment("monthly");
  });

  afterAll(async () => {
    if (userId) {
      await db
        .delete(paymentTransaction)
        .where(eq(paymentTransaction.accountId, userId));
      await db
        .delete(subscription)
        .where(eq(subscription.accountId, userId));
      await db
        .delete(inviteRedemption)
        .where(eq(inviteRedemption.accountId, userId));
      await db.delete(session).where(eq(session.userId, userId));
      await db.delete(user).where(eq(user.id, userId));
    }
    delete process.env.PAYMENT_PROVIDER_MODE;
  });

  it("returns 400 for invalid JSON body", async () => {
    const res = await app.request("/v1.0/qr/qr-mpm-notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not-valid-json{",
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.responseCode).toBe("4005201");
  });

  it("returns 404 for unknown order", async () => {
    const res = await app.request("/v1.0/qr/qr-mpm-notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        originalPartnerReferenceNo: "ZUKA-99991231-NONEXIST",
        originalReferenceNo: "ref-001",
        latestTransactionStatus: "00",
        transactionStatusDesc: "Success",
        amount: { value: "49000.00", currency: "IDR" },
      }),
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.responseCode).toBe("4045201");
  });

  it("returns 400 when amount does not match", async () => {
    const res = await app.request("/v1.0/qr/qr-mpm-notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        originalPartnerReferenceNo: orderId,
        originalReferenceNo: "ref-001",
        latestTransactionStatus: "00",
        transactionStatusDesc: "Success",
        amount: { value: "999999.00", currency: "IDR" }, // Wrong amount
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.responseCode).toBe("4005201");
    expect(body.responseMessage).toContain("Amount mismatch");
  });

  it("responds 200 with SNAP success for pending status (03)", async () => {
    const res = await app.request("/v1.0/qr/qr-mpm-notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        originalPartnerReferenceNo: orderId,
        originalReferenceNo: "ref-pending",
        latestTransactionStatus: "03",
        transactionStatusDesc: "Pending",
        amount: { value: "49000.00", currency: "IDR" },
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.responseCode).toBe("2005200");
    expect(body.responseMessage).toBe("Successful");

    // Payment should still be pending
    const [payment] = await db
      .select()
      .from(paymentTransaction)
      .where(eq(paymentTransaction.orderId, orderId))
      .limit(1);
    expect(payment.status).toBe("pending");
  });

  it("processes successful payment — marks paid and activates subscription", async () => {
    const res = await app.request("/v1.0/qr/qr-mpm-notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        originalPartnerReferenceNo: orderId,
        originalReferenceNo: "ref-success-001",
        latestTransactionStatus: "00",
        transactionStatusDesc: "Success",
        amount: { value: "49000.00", currency: "IDR" },
        additionalInfo: { rrn: "RRN-12345678" },
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.responseCode).toBe("2005200");
    expect(body.responseMessage).toBe("Successful");

    // Verify payment marked as paid
    const [payment] = await db
      .select()
      .from(paymentTransaction)
      .where(eq(paymentTransaction.orderId, orderId))
      .limit(1);
    expect(payment.status).toBe("paid");
    expect(payment.paidAt).toBeTruthy();
    expect(payment.rrn).toBe("RRN-12345678");
    expect(payment.providerReference).toBe("ref-success-001");
    expect(payment.rawWebhookPayload).toBeTruthy();

    // Verify subscription was activated
    const [sub] = await db
      .select()
      .from(subscription)
      .where(eq(subscription.accountId, userId))
      .limit(1);
    expect(sub).toBeTruthy();
    expect(sub.status).toBe("active");
    expect(sub.plan).toBe("monthly");
    expect(sub.startDate).toBeTruthy();
    expect(sub.endDate).toBeTruthy();

    // Verify payment is linked to subscription
    expect(payment.subscriptionId).toBe(sub.id);
  });

  it("handles idempotency — returns 200 for already-paid payment", async () => {
    // Send another success webhook for the same order (already paid)
    const res = await app.request("/v1.0/qr/qr-mpm-notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        originalPartnerReferenceNo: orderId,
        originalReferenceNo: "ref-success-001",
        latestTransactionStatus: "00",
        transactionStatusDesc: "Success",
        amount: { value: "49000.00", currency: "IDR" },
        additionalInfo: { rrn: "RRN-12345678" },
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.responseCode).toBe("2005200");

    // Should still have exactly one subscription (no duplicate)
    const subs = await db
      .select()
      .from(subscription)
      .where(eq(subscription.accountId, userId));
    expect(subs).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Full webhook-to-subscription flow with fresh user
// ---------------------------------------------------------------------------

describe("Full webhook flow — yearly plan activation", () => {
  let yearlyUserId = "";
  let yearlyOrderId = "";
  let yearlySessionToken = "";

  beforeAll(async () => {
    process.env.PAYMENT_PROVIDER_MODE = "fake";
    resetRateLimiterState();

    // Create fresh test user
    const phone = `+628${Date.now().toString().slice(-8)}YR`;
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
    yearlySessionToken = vBody.data?.token ?? vBody.data?.session?.token ?? "";
    yearlyUserId = vBody.data?.user?.id ?? "";

    // Create pending payment for yearly plan
    const piRes = await app.request(
      "/api/v1/subscription/payment-intents",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${yearlySessionToken}`,
        },
        body: JSON.stringify({ plan: "yearly" }),
      },
    );
    const piBody = await piRes.json();
    yearlyOrderId = piBody.data.orderId;
  });

  afterAll(async () => {
    if (yearlyUserId) {
      await db
        .delete(paymentTransaction)
        .where(eq(paymentTransaction.accountId, yearlyUserId));
      await db
        .delete(subscription)
        .where(eq(subscription.accountId, yearlyUserId));
      await db
        .delete(inviteRedemption)
        .where(eq(inviteRedemption.accountId, yearlyUserId));
      await db
        .delete(session)
        .where(eq(session.userId, yearlyUserId));
      await db.delete(user).where(eq(user.id, yearlyUserId));
    }
    delete process.env.PAYMENT_PROVIDER_MODE;
  });

  it("activates yearly subscription via webhook", async () => {
    const res = await app.request("/v1.0/qr/qr-mpm-notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        originalPartnerReferenceNo: yearlyOrderId,
        originalReferenceNo: "ref-yearly-001",
        latestTransactionStatus: "00",
        transactionStatusDesc: "Success",
        amount: { value: "475000.00", currency: "IDR" },
        additionalInfo: { rrn: "RRN-YEARLY-001" },
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.responseCode).toBe("2005200");

    // Verify subscription
    const [sub] = await db
      .select()
      .from(subscription)
      .where(eq(subscription.accountId, yearlyUserId))
      .limit(1);
    expect(sub).toBeTruthy();
    expect(sub.status).toBe("active");
    expect(sub.plan).toBe("yearly");
    expect(sub.paymentMethod).toBe("qris");

    // Duration should be ~365 days
    const durationDays = Math.round(
      (new Date(sub.endDate!).getTime() - new Date(sub.startDate!).getTime()) /
        (1000 * 60 * 60 * 24),
    );
    expect(durationDays).toBe(365);

    // Verify payment linked to subscription
    const [payment] = await db
      .select()
      .from(paymentTransaction)
      .where(eq(paymentTransaction.orderId, yearlyOrderId))
      .limit(1);
    expect(payment.status).toBe("paid");
    expect(payment.subscriptionId).toBe(sub.id);
  });
});
