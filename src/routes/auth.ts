import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { auth } from "../lib/auth.js";
import { requireAuth } from "../middleware/auth.js";
import { success } from "../lib/response.js";
import { db } from "../db/index.js";
import { accountRole, outlet, invite, inviteRedemption } from "../db/schema.js";
import { eq, and, sql } from "drizzle-orm";
import { z } from "zod";
import {
  registerSchema,
  verifyOtpSchema,
  merchantLoginSchema,
  merchantRegisterSchema,
} from "../validators/index.js";

const authRoutes = new Hono();

// POST /auth/register — phone number registration, trigger OTP
authRoutes.post("/register", zValidator("json", registerSchema), async (c) => {
  const { phoneNumber } = c.req.valid("json");
  const result = await auth.api.sendPhoneNumberOTP({ body: { phoneNumber } });
  return success(c, { message: "OTP sent", result });
});

// POST /auth/verify-otp — verify OTP, create member account, optionally claim invite
// Dev/test OTP bypass is handled at the plugin level in lib/auth.ts
authRoutes.post("/verify-otp", zValidator("json", verifyOtpSchema), async (c) => {
  const { phoneNumber, code, inviteCode } = c.req.valid("json");
  const result = await auth.api.verifyPhoneNumber({ body: { phoneNumber, code } });

  // If inviteCode provided and OTP verified successfully, claim the invite
  if (inviteCode && result?.user?.id) {
    const userId = result.user.id;
    const upperCode = inviteCode.toUpperCase();

    await db.transaction(async (tx) => {
      const [inv] = await tx
        .select()
        .from(invite)
        .where(eq(invite.code, upperCode))
        .limit(1);

      if (!inv || inv.status !== "active") return;
      if (inv.expiresAt && new Date(inv.expiresAt) < new Date()) return;

      // For single_use: check if any redemption already exists
      if (inv.type === "single_use") {
        const [existing] = await tx
          .select({ id: inviteRedemption.id })
          .from(inviteRedemption)
          .where(eq(inviteRedemption.inviteId, inv.id))
          .limit(1);
        if (existing) return;
      }

      // For multi_use: check count via atomic conditional update
      if (inv.type === "multi_use" && inv.maxRedemptions !== null) {
        const [updated] = await tx
          .update(invite)
          .set({ redeemedCount: sql`${invite.redeemedCount} + 1` })
          .where(and(
            eq(invite.id, inv.id),
            sql`${invite.redeemedCount} < ${inv.maxRedemptions}`,
          ))
          .returning();
        if (!updated) return; // limit reached
      } else {
        // single_use or unlimited multi_use: just increment
        await tx
          .update(invite)
          .set({ redeemedCount: sql`${invite.redeemedCount} + 1` })
          .where(eq(invite.id, inv.id));
      }

      // Insert redemption (unique constraint prevents duplicates)
      await tx.insert(inviteRedemption).values({
        inviteId: inv.id,
        accountId: userId,
        phase: "claimed",
        claimedAt: new Date(),
      }).onConflictDoNothing();
    });
  }

  return success(c, result);
});

// POST /auth/merchant/login — email + password login
authRoutes.post("/merchant/login", zValidator("json", merchantLoginSchema), async (c) => {
  const { email, password } = c.req.valid("json");
  const result = await auth.api.signInEmail({ body: { email, password }, headers: c.req.raw.headers });
  return success(c, result);
});

// POST /auth/merchant/register
authRoutes.post("/merchant/register", zValidator("json", merchantRegisterSchema), async (c) => {
  const { name, email, password } = c.req.valid("json");
  const result = await auth.api.signUpEmail({ body: { name, email, password } });
  return success(c, result, 201);
});

// POST /auth/merchant/forgot-password
authRoutes.post("/merchant/forgot-password", zValidator("json", z.object({ email: z.string().email() })), async (c) => {
  return success(c, { message: "Password reset email sent (placeholder)" });
});

// GET /auth/me — get current user + roles
authRoutes.get("/me", requireAuth, async (c) => {
  const user = c.get("user") as { id: string; name: string; email: string; phoneNumber?: string };
  const roles = await db
    .select({ role: accountRole.role, outletId: accountRole.outletId, outletLabel: outlet.label })
    .from(accountRole)
    .leftJoin(outlet, eq(accountRole.outletId, outlet.id))
    .where(eq(accountRole.accountId, user.id));

  return success(c, { id: user.id, name: user.name, email: user.email, phoneNumber: user.phoneNumber || null, roles });
});

// POST /auth/logout
authRoutes.post("/logout", requireAuth, async (c) => {
  await auth.api.signOut({ headers: c.req.raw.headers });
  return success(c, { message: "Logged out" });
});

export { authRoutes };
