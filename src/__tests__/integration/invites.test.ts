import { describe, it, expect, afterAll } from "vitest";
import { app } from "../../app.js";
import { db } from "../../db/index.js";
import { user, session, subscription, invite, inviteRedemption } from "../../db/schema.js";
import { eq } from "drizzle-orm";

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
});
