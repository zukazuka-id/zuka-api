import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { app } from "../../app.js";
import { db } from "../../db/index.js";
import { user, session, device } from "../../db/schema.js";
import { eq } from "drizzle-orm";
import { resetRateLimiterState } from "../../middleware/rate-limiter.js";

const TEST_PHONE = `+628${Date.now().toString().slice(-9)}d`;
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

describe("Device Registration Integration Tests", () => {
  beforeEach(() => {
    resetRateLimiterState();
  });

  afterAll(async () => {
    if (userId) {
      await db.delete(device).where(eq(device.accountId, userId));
      await db.delete(session).where(eq(session.userId, userId));
      await db.delete(user).where(eq(user.id, userId));
    }
  });

  it("POST /devices/register — requires auth", async () => {
    const res = await app.request("/api/v1/devices/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "fcm_test_token_12345", platform: "ios" }),
    });
    expect(res.status).toBe(401);
  });

  it("POST /devices/register — registers device and returns success", async () => {
    await setupTestUser();

    const res = await app.request("/api/v1/devices/register", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionToken}` },
      body: JSON.stringify({ token: `fcm_unique_${Date.now()}_abc`, platform: "ios" }),
    });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.registered).toBe(true);
  });

  it("POST /devices/register — upserts on duplicate token", async () => {
    const token = `fcm_upsert_test_${Date.now()}`;

    await app.request("/api/v1/devices/register", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionToken}` },
      body: JSON.stringify({ token, platform: "ios" }),
    });

    const res2 = await app.request("/api/v1/devices/register", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionToken}` },
      body: JSON.stringify({ token, platform: "android" }),
    });
    expect(res2.status).toBe(200);

    const rows = await db.select().from(device).where(eq(device.token, token));
    expect(rows.length).toBe(1);
    expect(rows[0].platform).toBe("android");
  });

  it("POST /devices/register — rejects invalid platform", async () => {
    const res = await app.request("/api/v1/devices/register", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionToken}` },
      body: JSON.stringify({ token: "fcm_test_invalid_platform", platform: "blackberry" }),
    });
    expect(res.status).toBe(400);
  });
});
