import { Hono } from "hono";
import { auth } from "../lib/auth.js";
import { requireAuth } from "../middleware/auth.js";
import { success, error } from "../lib/response.js";
import { db } from "../db/index.js";
import { accountRole, outlet } from "../db/schema.js";
import { eq } from "drizzle-orm";

const authRoutes = new Hono();

// POST /auth/register — phone number registration, trigger OTP
authRoutes.post("/register", async (c) => {
  const body = await c.req.json();
  const { phoneNumber } = body;
  if (!phoneNumber) {
    return error(c, "VALIDATION_ERROR", "Phone number is required", 400);
  }
  const result = await auth.api.sendPhoneNumberOTP({ body: { phoneNumber } });
  return success(c, { message: "OTP sent", result });
});

// POST /auth/verify-otp — verify OTP, create member account
authRoutes.post("/verify-otp", async (c) => {
  const body = await c.req.json();
  const { phoneNumber, code } = body;
  if (!phoneNumber || !code) {
    return error(c, "VALIDATION_ERROR", "Phone number and OTP code are required", 400);
  }
  const result = await auth.api.verifyPhoneNumber({ body: { phoneNumber, code } });
  return success(c, result);
});

// POST /auth/merchant/login — email + password login
authRoutes.post("/merchant/login", async (c) => {
  const body = await c.req.json();
  const { email, password } = body;
  if (!email || !password) {
    return error(c, "VALIDATION_ERROR", "Email and password are required", 400);
  }
  const result = await auth.api.signInEmail({ body: { email, password }, headers: c.req.raw.headers });
  return success(c, result);
});

// POST /auth/merchant/register
authRoutes.post("/merchant/register", async (c) => {
  const body = await c.req.json();
  const { name, email, password } = body;
  if (!name || !email || !password) {
    return error(c, "VALIDATION_ERROR", "Name, email, and password are required", 400);
  }
  const result = await auth.api.signUpEmail({ body: { name, email, password } });
  return success(c, result, 201);
});

// POST /auth/merchant/forgot-password
authRoutes.post("/merchant/forgot-password", async (c) => {
  const body = await c.req.json();
  const { email } = body;
  if (!email) {
    return error(c, "VALIDATION_ERROR", "Email is required", 400);
  }
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
