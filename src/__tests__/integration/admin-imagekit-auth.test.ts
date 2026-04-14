import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../../app.js";
import { db } from "../../db/index.js";
import { session, user } from "../../db/schema.js";
import { eq } from "drizzle-orm";

const originalPublicKey = process.env.IMAGEKIT_PUBLIC_KEY;
const originalPrivateKey = process.env.IMAGEKIT_PRIVATE_KEY;

const adminUserId = crypto.randomUUID();
const adminSessionToken = crypto.randomUUID();
const memberUserId = crypto.randomUUID();
const memberSessionToken = crypto.randomUUID();

describe("Admin ImageKit upload auth", () => {
  beforeAll(async () => {
    process.env.IMAGEKIT_PUBLIC_KEY = "public_test_key";
    process.env.IMAGEKIT_PRIVATE_KEY = "private_test_key";

    await db.insert(user).values([
      {
        id: adminUserId,
        name: "Admin ImageKit",
        email: `admin-imagekit-${Date.now()}@test.com`,
        role: "admin",
        emailVerified: true,
      },
      {
        id: memberUserId,
        name: "Member ImageKit",
        email: `member-imagekit-${Date.now()}@test.com`,
        role: "user",
        emailVerified: true,
      },
    ]);

    await db.insert(session).values([
      {
        id: crypto.randomUUID(),
        userId: adminUserId,
        token: adminSessionToken,
        expiresAt: new Date(Date.now() + 1000 * 60 * 60),
      },
      {
        id: crypto.randomUUID(),
        userId: memberUserId,
        token: memberSessionToken,
        expiresAt: new Date(Date.now() + 1000 * 60 * 60),
      },
    ]);
  });

  afterAll(async () => {
    process.env.IMAGEKIT_PUBLIC_KEY = originalPublicKey;
    process.env.IMAGEKIT_PRIVATE_KEY = originalPrivateKey;

    await db.delete(session).where(eq(session.userId, adminUserId));
    await db.delete(session).where(eq(session.userId, memberUserId));
    await db.delete(user).where(eq(user.id, adminUserId));
    await db.delete(user).where(eq(user.id, memberUserId));
  });

  it("rejects unauthenticated access", async () => {
    const res = await app.request("/api/v1/admin/imagekit/upload-auth");

    expect(res.status).toBe(401);
  });

  it("rejects authenticated non-admin access", async () => {
    const res = await app.request("/api/v1/admin/imagekit/upload-auth", {
      headers: {
        Authorization: `Bearer ${memberSessionToken}`,
      },
    });

    expect(res.status).toBe(403);
  });

  it("returns upload auth parameters for admins without leaking the private key", async () => {
    const res = await app.request("/api/v1/admin/imagekit/upload-auth", {
      headers: {
        Authorization: `Bearer ${adminSessionToken}`,
      },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.publicKey).toBe("public_test_key");
    expect(typeof body.data.token).toBe("string");
    expect(body.data.token.length).toBeGreaterThan(10);
    expect(typeof body.data.signature).toBe("string");
    expect(body.data.signature.length).toBeGreaterThan(10);
    expect(typeof body.data.expire).toBe("number");
    expect(body.data.privateKey).toBeUndefined();
  });
});
