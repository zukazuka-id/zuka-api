import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../app.js";
import { db } from "../../db/index.js";
import {
  user,
  session,
  subscription,
  invite,
  inviteRedemption,
  authCredential,
  platformConfig,
} from "../../db/schema.js";
import { eq } from "drizzle-orm";

const ADMIN_EMAIL = `admin-config-${Date.now()}@test.com`;
const ADMIN_PASS = "testpass123";
let adminUserId = "";
let adminSessionToken = "";

describe("Public Config Endpoint", () => {
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
  });

  afterAll(async () => {
    if (adminUserId) {
      await db.delete(inviteRedemption).where(eq(inviteRedemption.accountId, adminUserId));
      await db.delete(invite).where(eq(invite.referrerId, adminUserId));
      await db.delete(subscription).where(eq(subscription.accountId, adminUserId));
      await db.delete(authCredential).where(eq(authCredential.userId, adminUserId));
      await db.delete(session).where(eq(session.userId, adminUserId));
      await db.delete(user).where(eq(user.id, adminUserId));
    }
  });

  describe("GET /api/v1/config", () => {
    it("returns 200 with value for public config key (daily_invite_limit)", async () => {
      const res = await app.request("/api/v1/config?key=daily_invite_limit");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.key).toBe("daily_invite_limit");
      expect(body.data.value).toBe("10");
    });

    it("returns 404 for nonexistent config key", async () => {
      const res = await app.request("/api/v1/config?key=nonexistent_key_xyz");
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe("NOT_FOUND");
    });
  });

  describe("GET /api/v1/admin/config", () => {
    it("returns 401 without auth", async () => {
      const res = await app.request("/api/v1/admin/config");
      expect(res.status).toBe(401);
    });

    it("returns array with seed data for admin", async () => {
      const res = await app.request("/api/v1/admin/config", {
        headers: { Authorization: `Bearer ${adminSessionToken}` },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("PUT /api/v1/admin/config", () => {
    it("upserts a new config entry (201-equivalent 200)", async () => {
      const res = await app.request("/api/v1/admin/config", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminSessionToken}`,
        },
        body: JSON.stringify({ key: "test_key", value: "42", isPublic: true }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.key).toBe("test_key");
      expect(body.data.value).toBe("42");
      expect(body.data.isPublic).toBe(true);
    });

    it("idempotent update returns 200", async () => {
      const res = await app.request("/api/v1/admin/config", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminSessionToken}`,
        },
        body: JSON.stringify({ key: "test_key", value: "99", isPublic: false }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.value).toBe("99");
      expect(body.data.isPublic).toBe(false);

      // Verify the update persisted
      const publicRes = await app.request("/api/v1/config?key=test_key");
      expect(publicRes.status).toBe(404); // no longer public
    });
  });

  describe("DELETE /api/v1/admin/config/:key", () => {
    it("removes a config entry", async () => {
      const res = await app.request("/api/v1/admin/config/test_key", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${adminSessionToken}` },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.deleted).toBe(true);
    });

    it("returns 404 for nonexistent key", async () => {
      const res = await app.request("/api/v1/admin/config/nonexistent_key_xyz", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${adminSessionToken}` },
      });
      expect(res.status).toBe(404);
    });

    it("GET /config returns 404 after deletion", async () => {
      const res = await app.request("/api/v1/config?key=test_key");
      expect(res.status).toBe(404);
    });
  });
});
