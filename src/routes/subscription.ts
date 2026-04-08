import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { db } from "../db/index.js";
import { subscription, inviteRedemption } from "../db/schema.js";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth } from "../middleware/auth.js";
import { success, error } from "../lib/response.js";
import { createSubscriptionSchema } from "../validators/index.js";

type UserVars = {
  user: { id: string; name: string; email: string; [key: string]: unknown };
  session: { id: string; token: string; [key: string]: unknown };
  userRoles: { role: string; outletId: string }[];
};

const subscriptionRoutes = new Hono<{ Variables: UserVars }>();
subscriptionRoutes.use("*", requireAuth);

// POST /subscription/create
subscriptionRoutes.post("/create", zValidator("json", createSubscriptionSchema), async (c) => {
  const user = c.get("user") as UserVars["user"];
  const { plan } = c.req.valid("json");

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

  const sub = await db.transaction(async (tx) => {
    const [created] = await tx
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

    // Auto-consume any claimed invite for this user
    const [claimed] = await tx
      .select()
      .from(inviteRedemption)
      .where(and(
        eq(inviteRedemption.accountId, user.id),
        eq(inviteRedemption.phase, "claimed"),
      ))
      .limit(1);

    if (claimed) {
      await tx
        .update(inviteRedemption)
        .set({ phase: "consumed", consumedAt: new Date() })
        .where(eq(inviteRedemption.id, claimed.id));
    }

    return created;
  });

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
    .orderBy(desc(subscription.createdAt))
    .limit(1);

  if (!sub) {
    return success(c, { hasSubscription: false });
  }

  const isExpired = sub.endDate ? new Date(sub.endDate) < new Date() : false;

  // Persist expired status if DB says active but endDate has passed
  if (isExpired && sub.status === "active") {
    await db
      .update(subscription)
      .set({ status: "expired" })
      .where(eq(subscription.id, sub.id));
  }

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
