import { db } from "../db/index.js";
import { invite, inviteRedemption } from "../db/schema.js";
import { eq, and, sql } from "drizzle-orm";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface InviteValidationResult {
  valid: true;
  invite: typeof invite.$inferSelect;
}

export interface InviteValidationError {
  valid: false;
  code: string;
  message: string;
  status: number;
}

export async function validateInvite(code: string): Promise<InviteValidationResult | InviteValidationError> {
  const [inv] = await db
    .select()
    .from(invite)
    .where(eq(invite.code, code.toUpperCase()))
    .limit(1);

  if (!inv) {
    return { valid: false, code: "NOT_FOUND", message: "Invalid invite code", status: 404 };
  }

  if (inv.status !== "active") {
    return { valid: false, code: "INVALID_CODE", message: "This invite code is no longer active", status: 400 };
  }

  if (inv.expiresAt && new Date(inv.expiresAt) < new Date()) {
    return { valid: false, code: "EXPIRED", message: "This invite code has expired", status: 410 };
  }

  if (inv.type === "single_use") {
    const [existing] = await db
      .select({ id: inviteRedemption.id })
      .from(inviteRedemption)
      .where(eq(inviteRedemption.inviteId, inv.id))
      .limit(1);

    if (existing) {
      return { valid: false, code: "ALREADY_REDEEMED", message: "This invite code has already been used", status: 409 };
    }
  }

  if (inv.type === "multi_use" && inv.maxRedemptions !== null && inv.redeemedCount >= inv.maxRedemptions) {
    return { valid: false, code: "LIMIT_REACHED", message: "This invite code has reached its redemption limit", status: 409 };
  }

  return { valid: true, invite: inv };
}

export async function claimInvite(
  tx: Transaction,
  inviteId: string,
  accountId: string,
  maxRedemptions: number | null,
  type: string,
): Promise<boolean> {
  if (type === "multi_use" && maxRedemptions !== null) {
    const [updated] = await tx
      .update(invite)
      .set({ redeemedCount: sql`${invite.redeemedCount} + 1` })
      .where(and(
        eq(invite.id, inviteId),
        sql`${invite.redeemedCount} < ${maxRedemptions}`,
      ))
      .returning();

    if (!updated) return false;
  } else {
    await tx
      .update(invite)
      .set({ redeemedCount: sql`${invite.redeemedCount} + 1` })
      .where(eq(invite.id, inviteId));
  }

  await tx.insert(inviteRedemption).values({
    inviteId,
    accountId,
    phase: "claimed",
    claimedAt: new Date(),
  }).onConflictDoNothing();

  return true;
}

export async function consumeInvite(
  tx: Transaction,
  accountId: string,
): Promise<void> {
  const [claimed] = await tx
    .select()
    .from(inviteRedemption)
    .where(and(
      eq(inviteRedemption.accountId, accountId),
      eq(inviteRedemption.phase, "claimed"),
    ))
    .limit(1);

  if (claimed) {
    await tx
      .update(inviteRedemption)
      .set({ phase: "consumed", consumedAt: new Date() })
      .where(eq(inviteRedemption.id, claimed.id));
  }
}
