import { eq, and, desc } from "drizzle-orm";
import { db } from "../db/index.js";
import { subscription, paymentTransaction } from "../db/schema.js";
import { getSubscriptionPlanConfig, type PlanTier } from "./subscription-plans.js";
import { consumeInvite } from "./invite-service.js";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface ActivateSubscriptionInput {
  accountId: string;
  plan: PlanTier;
  paymentMethod: string;
  paymentId?: string;
}

/**
 * Activate or queue a subscription for an account.
 *
 * This is the single code path for all subscription activations:
 * - Paid plans via Yukk webhook (Task 8)
 * - Free plan short-circuit in payment-intent creation (Task 5)
 * - Admin grant endpoint (Task 20)
 *
 * Idempotency: If `paymentId` is provided and that payment already has
 * a `subscriptionId`, the existing subscription is returned without
 * re-activating.
 *
 * Renewal queuing: If the account already has an active subscription,
 * the new subscription is queued to start when the current one ends.
 */
export async function activateSubscription(
  tx: Transaction,
  input: ActivateSubscriptionInput,
) {
  const { accountId, plan, paymentMethod, paymentId } = input;
  const planConfig = getSubscriptionPlanConfig(plan);

  // ── Idempotency: payment already linked to a subscription ──────────
  if (paymentId) {
    const [existingPayment] = await tx
      .select({ subscriptionId: paymentTransaction.subscriptionId })
      .from(paymentTransaction)
      .where(eq(paymentTransaction.id, paymentId))
      .limit(1);

    if (existingPayment?.subscriptionId) {
      // Already activated — return the existing subscription
      const [existingSub] = await tx
        .select()
        .from(subscription)
        .where(eq(subscription.id, existingPayment.subscriptionId))
        .limit(1);

      return existingSub!;
    }
  }

  // ── Check for active subscription (renewal queuing) ────────────────
  const [activeSub] = await tx
    .select()
    .from(subscription)
    .where(
      and(
        eq(subscription.accountId, accountId),
        eq(subscription.status, "active"),
      ),
    )
    .orderBy(desc(subscription.endDate))
    .limit(1);

  const now = new Date();

  let startDate: Date;
  let endDate: Date;

  if (activeSub && new Date(activeSub.endDate!) > now) {
    // Renewal queuing: new sub starts when current one ends
    startDate = new Date(activeSub.endDate!);
    endDate = new Date(
      startDate.getTime() + planConfig.durationDays * 24 * 60 * 60 * 1000,
    );
  } else {
    // New activation: starts now
    startDate = now;
    endDate = new Date(
      now.getTime() + planConfig.durationDays * 24 * 60 * 60 * 1000,
    );
  }

  // ── Insert subscription ────────────────────────────────────────────
  const [newSub] = await tx
    .insert(subscription)
    .values({
      accountId,
      status: "active",
      plan: planConfig.plan,
      startDate,
      endDate,
      paymentMethod,
    })
    .returning();

  // ── Link payment transaction if provided ───────────────────────────
  if (paymentId) {
    await tx
      .update(paymentTransaction)
      .set({ subscriptionId: newSub!.id, updatedAt: new Date() })
      .where(eq(paymentTransaction.id, paymentId));
  }

  // ── Consume claimed invite ─────────────────────────────────────────
  await consumeInvite(tx, accountId);

  return newSub!;
}
