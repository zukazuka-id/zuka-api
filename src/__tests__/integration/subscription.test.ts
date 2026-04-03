import { describe, it, expect, afterAll } from "vitest";
import { app } from "../../app.js";
import { db } from "../../db/index.js";
import { user, session, subscription } from "../../db/schema.js";
import { eq } from "drizzle-orm";

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
      body: JSON.stringify({ plan: "annual" }),
    });
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.data.subscriptionId).toBeTruthy();
    expect(body.data.plan).toBe("annual");
    expect(body.data.amount).toBe(990000);
  });

  it("POST /subscription/create — duplicate subscription returns 409", async () => {
    const res = await app.request("/api/v1/subscription/create", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionToken}` },
      body: JSON.stringify({ plan: "annual" }),
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
    expect(body.data.plan).toBe("annual");
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
