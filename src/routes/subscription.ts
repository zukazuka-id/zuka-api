import { Hono } from "hono";
import { db } from "../db/index.js";
import { subscription } from "../db/schema.js";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "../middleware/auth.js";
import { success, error } from "../lib/response.js";

type UserVars = {
  user: { id: string; name: string; email: string; [key: string]: unknown };
  session: { id: string; token: string; [key: string]: unknown };
  userRoles: { role: string; outletId: string }[];
};

const subscriptionRoutes = new Hono<{ Variables: UserVars }>();
subscriptionRoutes.use("*", requireAuth);

// POST /subscription/create
subscriptionRoutes.post("/create", async (c) => {
  const user = c.get("user") as UserVars["user"];
  const body = await c.req.json();
  const plan = body.plan || "annual";

  const [existing] = await db
    .select()
    .from(subscription)
    .where(and(eq(subscription.accountId, user.id), eq(subscription.status, "active")))
    .limit(1);

  if (existing) {
    return error(c, "CONFLICT", "You already have an active subscription", 409);
  }

  const amount = plan === "monthly" ? 99000 : 990000;
  const durationDays = plan === "monthly" ? 30 : 365;

  const [sub] = await db
    .insert(subscription)
    .values({
      accountId: user.id,
      plan,
      status: "active",
      startDate: new Date(),
      endDate: new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000),
      paymentMethod: "qris",
    })
    .returning();

  return success(c, {
    subscriptionId: sub.id,
    amount,
    plan,
    paymentMethod: "qris",
    paymentUrl: `https://mock-payment.zuka.id/pay?sub=${sub.id}`,
  }, 201);
});

// GET /subscription/status
subscriptionRoutes.get("/status", async (c) => {
  const user = c.get("user") as UserVars["user"];

  const [sub] = await db
    .select()
    .from(subscription)
    .where(eq(subscription.accountId, user.id))
    .limit(1);

  if (!sub) {
    return success(c, { hasSubscription: false });
  }

  const isExpired = sub.endDate ? new Date(sub.endDate) < new Date() : false;

  return success(c, {
    hasSubscription: true,
    id: sub.id,
    plan: sub.plan,
    status: isExpired ? "expired" : sub.status,
    startDate: sub.startDate,
    endDate: sub.endDate,
    daysRemaining: sub.endDate
      ? Math.max(0, Math.ceil((new Date(sub.endDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
      : null,
  });
});

export { subscriptionRoutes };
