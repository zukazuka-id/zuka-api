import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { db } from "../db/index.js";
import { subscription, paymentTransaction, inviteRedemption, invite } from "../db/schema.js";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth } from "../middleware/auth.js";
import { success, error } from "../lib/response.js";
import { consumeInvite } from "../lib/invite-service.js";
import { createSubscriptionSchema, createSubscriptionPaymentIntentSchema } from "../validators/index.js";
import { getSubscriptionPlanConfig, isFreePlan, type PlanTier } from "../lib/subscription-plans.js";
import { activateSubscription } from "../lib/subscription-activation.js";
import { createYukkQrisPayment } from "../lib/yukk.js";

type UserVars = {
  user: { id: string; name: string; email: string; [key: string]: unknown };
  session: { id: string; token: string; [key: string]: unknown };
  userRoles: { role: string; outletId: string }[];
};

const subscriptionRoutes = new Hono<{ Variables: UserVars }>();
subscriptionRoutes.use("*", requireAuth);

// POST /subscription/create — DEPRECATED: requires ALLOW_UNVERIFIED_SUBSCRIPTION_CREATE=true
subscriptionRoutes.post("/create", zValidator("json", createSubscriptionSchema), async (c) => {
  // Gate behind env flag — in production (no flag), return 410 Gone
  if (!process.env.ALLOW_UNVERIFIED_SUBSCRIPTION_CREATE) {
    return c.json({
      success: false,
      error: {
        code: "GONE",
        message: "Use POST /subscription/payment-intents to create a payment. This endpoint is deprecated.",
      },
    }, 410);
  }

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
    await consumeInvite(tx, user.id);

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

// POST /payment-intents — Create a payment intent for subscription purchase
subscriptionRoutes.post("/payment-intents", zValidator("json", createSubscriptionPaymentIntentSchema), async (c) => {
  const user = c.get("user") as UserVars["user"];
  const { plan: requestedPlan } = c.req.valid("json");

  // ── Check for invite planOverride ──────────────────────────────
  // If the user claimed an invite with a planOverride, use that plan instead.
  const [claimedInvite] = await db
    .select({ planOverride: inviteRedemption.planOverride })
    .from(inviteRedemption)
    .innerJoin(invite, eq(inviteRedemption.inviteId, invite.id))
    .where(
      and(
        eq(inviteRedemption.accountId, user.id),
        eq(inviteRedemption.phase, "claimed"),
      ),
    )
    .limit(1);

  const plan = (claimedInvite?.planOverride ?? requestedPlan) as PlanTier;
  const planConfig = getSubscriptionPlanConfig(plan);

  // ── Reviewer plan guard ────────────────────────────────────
  // Reviewer plans bypass Yukk entirely — no paymentTransaction,
  // no QRIS — so they never interfere with Yukk reconciliation.
  if (plan === "reviewer") {
    const reviewerPhones = (process.env.REVIEWER_PHONES ?? "").split(",").filter(Boolean);
    const userPhone = (user as Record<string, unknown>).phoneNumber as string | undefined;

    if (!userPhone || !reviewerPhones.includes(userPhone)) {
      return error(c, "FORBIDDEN", "Reviewer access not allowed for this account", 403);
    }

    const activated = await db.transaction(async (tx) => {
      return activateSubscription(tx, {
        accountId: user.id,
        plan: "reviewer",
        paymentMethod: "reviewer",
      });
    });

    return success(c, {
      subscription: {
        id: activated.id,
        plan: activated.plan,
        status: activated.status,
        startDate: activated.startDate,
        endDate: activated.endDate,
        paymentMethod: "reviewer",
      },
    }, 201);
  }

  // ── Free plan short-circuit ────────────────────────────────────
  if (isFreePlan(plan as PlanTier)) {
    const activated = await db.transaction(async (tx) => {
      // Insert payment_transaction as paid (free plan)
      const [payment] = await tx
        .insert(paymentTransaction)
        .values({
          accountId: user.id,
          orderId: `ZUKA-${generateDateStamp()}-${generateShortRandom()}`,
          provider: "yukk",
          method: "qris",
          amount: 0,
          currency: "IDR",
          plan: plan as PlanTier,
          status: "paid",
          paidAt: new Date(),
        })
        .returning();

      const sub = await activateSubscription(tx, {
        accountId: user.id,
        plan: plan as PlanTier,
        paymentMethod: `free:${plan}`,
        paymentId: payment.id,
      });

      return sub;
    });

    return success(c, {
      subscription: {
        id: activated.id,
        plan: activated.plan,
        status: activated.status,
        startDate: activated.startDate,
        endDate: activated.endDate,
        paymentMethod: `free:${plan}`,
      },
    }, 201);
  }

  // ── Paid plan flow ─────────────────────────────────────────────

  // Check for reusable pending non-expired payment for same user+plan
  const [existingPending] = await db
    .select()
    .from(paymentTransaction)
    .where(
      and(
        eq(paymentTransaction.accountId, user.id),
        eq(paymentTransaction.plan, plan as PlanTier),
        eq(paymentTransaction.status, "pending"),
      ),
    )
    .orderBy(desc(paymentTransaction.createdAt))
    .limit(1);

  if (existingPending && existingPending.expiresAt && new Date(existingPending.expiresAt) > new Date()) {
    // Reuse the existing pending payment
    return success(c, {
      paymentId: existingPending.id,
      orderId: existingPending.orderId,
      providerReference: existingPending.providerReference,
      amount: existingPending.amount,
      currency: existingPending.currency,
      status: existingPending.status,
      qrisPayload: existingPending.qrisPayload,
      expiresAt: existingPending.expiresAt,
      timeoutInSeconds: existingPending.timeoutInSeconds,
    });
  }

  // Format amount as string with 2 decimal places for Yukk
  const amountStr = planConfig.amount.toFixed(2);
  const orderId = `ZUKA-${generateDateStamp()}-${generateShortRandom()}`;

  // Insert local payment_transaction with status "pending" before provider call
  const [payment] = await db
    .insert(paymentTransaction)
    .values({
      accountId: user.id,
      orderId,
      provider: "yukk",
      method: "qris",
      amount: planConfig.amount,
      currency: "IDR",
      plan: plan as PlanTier,
      status: "pending",
    })
    .returning();

  // Call Yukk to create QRIS payment
  let yukkResult;
  try {
    yukkResult = await createYukkQrisPayment({
      partnerReferenceNo: orderId,
      amount: amountStr,
    });
  } catch (err) {
    // Update payment status to failed
    await db
      .update(paymentTransaction)
      .set({ status: "failed", updatedAt: new Date() })
      .where(eq(paymentTransaction.id, payment.id));

    const message = err instanceof Error ? err.message : "Payment provider error";
    return error(c, "PAYMENT_PROVIDER_ERROR", message, 502);
  }

  // Calculate expiry from timeout
  const expiresAt = new Date(Date.now() + yukkResult.timeoutInSeconds * 1000);

  // Update transaction with provider response data
  await db
    .update(paymentTransaction)
    .set({
      providerReference: yukkResult.referenceNo,
      qrisPayload: yukkResult.qrContent,
      timeoutInSeconds: yukkResult.timeoutInSeconds,
      expiresAt,
      rawCreateResponse: yukkResult as unknown as Record<string, unknown>,
      updatedAt: new Date(),
    })
    .where(eq(paymentTransaction.id, payment.id));

  return success(c, {
    paymentId: payment.id,
    orderId,
    providerReference: yukkResult.referenceNo,
    amount: planConfig.amount,
    currency: "IDR",
    status: "pending",
    qrisPayload: yukkResult.qrContent,
    expiresAt: expiresAt.toISOString(),
    timeoutInSeconds: yukkResult.timeoutInSeconds,
  }, 201);
});

// GET /payment-intents/:paymentId — Poll payment status
subscriptionRoutes.get("/payment-intents/:paymentId", async (c) => {
  const user = c.get("user") as UserVars["user"];
  const paymentId = c.req.param("paymentId");

  const [payment] = await db
    .select()
    .from(paymentTransaction)
    .where(eq(paymentTransaction.id, paymentId))
    .limit(1);

  if (!payment) {
    return error(c, "NOT_FOUND", "Payment not found", 404);
  }

  // Ensure the payment belongs to the authenticated user
  if (payment.accountId !== user.id) {
    return error(c, "NOT_FOUND", "Payment not found", 404);
  }

  // Auto-expire pending payments past their expiry time
  let currentStatus = payment.status;
  if (currentStatus === "pending" && payment.expiresAt && new Date(payment.expiresAt) < new Date()) {
    await db
      .update(paymentTransaction)
      .set({ status: "expired", updatedAt: new Date() })
      .where(eq(paymentTransaction.id, payment.id));
    currentStatus = "expired";
  }

  // Look up related subscription if linked
  let subscriptionId: string | null = null;
  let subscriptionStatus: string | null = null;
  if (payment.subscriptionId) {
    const [sub] = await db
      .select({ id: subscription.id, status: subscription.status })
      .from(subscription)
      .where(eq(subscription.id, payment.subscriptionId))
      .limit(1);
    if (sub) {
      subscriptionId = sub.id;
      subscriptionStatus = sub.status;
    }
  }

  return success(c, {
    paymentId: payment.id,
    orderId: payment.orderId,
    status: currentStatus,
    plan: payment.plan,
    amount: payment.amount,
    currency: payment.currency,
    expiresAt: payment.expiresAt,
    paidAt: payment.paidAt,
    subscriptionId,
    subscriptionStatus,
  });
});

// ── Helpers ──────────────────────────────────────────────────────────

function generateDateStamp(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
}

function generateShortRandom(): string {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

export { subscriptionRoutes };
