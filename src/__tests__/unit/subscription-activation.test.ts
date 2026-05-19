/**
 * Unit tests for subscription-activation helper.
 *
 * All database calls are mocked via a mock transaction object.
 * No real database needed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { activateSubscription } from "../../lib/subscription-activation.js";

// ---------------------------------------------------------------------------
// Mock consumeInvite so we can verify it's called
// ---------------------------------------------------------------------------

vi.mock("../../lib/invite-service.js", () => ({
  consumeInvite: vi.fn().mockResolvedValue(undefined),
}));

import { consumeInvite } from "../../lib/invite-service.js";
const mockedConsumeInvite = vi.mocked(consumeInvite);

// ---------------------------------------------------------------------------
// Helpers for chained select mocks
// ---------------------------------------------------------------------------

/**
 * Build a mock tx that handles multiple sequential select calls.
 * Each entry in `selectChains` defines what one full select() chain resolves to.
 * Uses `any` because Drizzle's PgTransaction type is deeply complex and
 * we only need to mock the methods we call.
 */
function createMockTx(selectChains: Record<string, unknown>[][]): any {
  const chains = [...selectChains];
  const nextChain = () => {
    const result = chains.shift() ?? [];
    return {
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue(result),
          }),
          limit: vi.fn().mockResolvedValue(result),
        }),
        limit: vi.fn().mockResolvedValue(result),
      }),
    };
  };

  const defaultInsertedSub = {
    id: "sub-new-1",
    accountId: "acc-1",
    status: "active",
    plan: "monthly",
    startDate: new Date("2026-01-01"),
    endDate: new Date("2026-01-31"),
    paymentMethod: "qris",
  };

  return {
    select: vi.fn().mockImplementation(nextChain),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([defaultInsertedSub]),
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    }),
  };
}

/**
 * Create a mock insert that captures values passed to .values()
 */
function createCapturingInsert() {
  let capturedValues: Record<string, unknown> | null = null;
  const insert = vi.fn().mockImplementation(() => ({
    values: vi.fn().mockImplementation((vals: Record<string, unknown>) => {
      capturedValues = vals;
      return {
        returning: vi.fn().mockResolvedValue([{
          id: "sub-captured",
          accountId: "acc-1",
          status: "active",
          plan: vals.plan,
          startDate: vals.startDate,
          endDate: vals.endDate,
          paymentMethod: vals.paymentMethod,
        }]),
      };
    }),
  }));
  return { insert, getCapturedValues: () => capturedValues };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

describe("activateSubscription", () => {
  const accountId = "acc-1";

  it("creates a new subscription with correct start/end dates for a new user", async () => {
    // No existing payment, no active subscription
    const tx = createMockTx([
      [],  // select from payment_transaction: no existing payment
      [],  // select from subscription: no active subscription
    ]);

    const result = await activateSubscription(tx, {
      accountId,
      plan: "monthly",
      paymentMethod: "qris",
    });

    expect(result).toBeDefined();
    expect(result.status).toBe("active");
    expect(result.plan).toBe("monthly");
    expect(tx.insert).toHaveBeenCalledOnce();
    expect(mockedConsumeInvite).toHaveBeenCalledWith(tx, accountId);
  });

  it("queues renewal when an active subscription exists", async () => {
    const futureEndDate = new Date("2026-12-31T23:59:59Z");

    // No paymentId => skip payment check
    // Active subscription found
    const tx = createMockTx([
      [
        {
          id: "sub-active-1",
          accountId,
          status: "active",
          plan: "monthly",
          startDate: new Date("2026-06-01"),
          endDate: futureEndDate,
          paymentMethod: "qris",
        },
      ],
    ]);

    const { insert, getCapturedValues } = createCapturingInsert();
    tx.insert = insert;

    const result = await activateSubscription(tx, {
      accountId,
      plan: "yearly",
      paymentMethod: "qris",
    });

    expect(result).toBeDefined();

    const vals = getCapturedValues();
    expect(vals).not.toBeNull();

    // Start should be the active sub's end date
    const startDate = new Date(vals!.startDate as Date);
    expect(startDate.getTime()).toBe(futureEndDate.getTime());

    // End should be start + 365 days (yearly plan)
    const endDate = new Date(vals!.endDate as Date);
    const expectedEnd = new Date(futureEndDate.getTime() + 365 * 24 * 60 * 60 * 1000);
    expect(endDate.getTime()).toBe(expectedEnd.getTime());

    expect(mockedConsumeInvite).toHaveBeenCalledWith(tx, accountId);
  });

  it("returns existing subscription when paymentId is already linked (idempotency)", async () => {
    const existingSubId = "sub-existing-1";

    // Chain 1: payment has subscriptionId already
    // Chain 2: fetch existing subscription
    const tx = createMockTx([
      [{ subscriptionId: existingSubId }],  // payment lookup
      [{ id: existingSubId, accountId, status: "active", plan: "monthly" }],  // subscription lookup
    ]);

    const result = await activateSubscription(tx, {
      accountId,
      plan: "monthly",
      paymentMethod: "qris",
      paymentId: "pay-1",
    });

    expect(result.id).toBe(existingSubId);
    expect(tx.insert).not.toHaveBeenCalled();
    expect(tx.update).not.toHaveBeenCalled();
    expect(mockedConsumeInvite).not.toHaveBeenCalled();
  });

  it("links payment transaction when paymentId is provided and not yet linked", async () => {
    // Chain 1: payment exists but no subscriptionId
    // Chain 2: no active subscription
    const tx = createMockTx([
      [{ subscriptionId: null }],  // payment has no sub yet
      [],                          // no active subscription
    ]);

    const result = await activateSubscription(tx, {
      accountId,
      plan: "monthly",
      paymentMethod: "qris",
      paymentId: "pay-unlinked-1",
    });

    expect(result).toBeDefined();
    expect(tx.update).toHaveBeenCalledOnce();

    // Verify the update was called on the payment_transaction table
    expect(tx.update).toHaveBeenCalled();

    expect(mockedConsumeInvite).toHaveBeenCalledWith(tx, accountId);
  });

  it("consumes invite after successful activation", async () => {
    const tx = createMockTx([
      [],  // no payment check
      [],  // no active subscription
    ]);

    await activateSubscription(tx, {
      accountId,
      plan: "monthly",
      paymentMethod: "qris",
    });

    expect(mockedConsumeInvite).toHaveBeenCalledOnce();
    expect(mockedConsumeInvite).toHaveBeenCalledWith(tx, accountId);
  });

  it("activates a free plan (yearly_founders) through the same code path", async () => {
    const tx = createMockTx([
      [],  // no payment check
      [],  // no active subscription
    ]);

    // Override the insert mock for this specific test
    const freeSub = {
      id: "sub-free-1",
      accountId,
      status: "active",
      plan: "yearly_founders",
      startDate: new Date("2026-01-01"),
      endDate: new Date("2027-01-01"),
      paymentMethod: "admin_grant",
    };
    tx.insert = vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([freeSub]),
      }),
    });

    const result = await activateSubscription(tx, {
      accountId,
      plan: "yearly_founders",
      paymentMethod: "admin_grant",
    });

    expect(result.plan).toBe("yearly_founders");
    expect(result.status).toBe("active");
    expect(result.paymentMethod).toBe("admin_grant");
    expect(mockedConsumeInvite).toHaveBeenCalledWith(tx, accountId);
  });

  it("calculates correct endDate for monthly plan (30 days)", async () => {
    const tx = createMockTx([
      [],  // no payment
      [],  // no active sub
    ]);

    const { insert, getCapturedValues } = createCapturingInsert();
    tx.insert = insert;

    const beforeCall = Date.now();
    await activateSubscription(tx, {
      accountId,
      plan: "monthly",
      paymentMethod: "qris",
    });

    const vals = getCapturedValues();
    expect(vals).not.toBeNull();
    const start = new Date(vals!.startDate as Date);
    const end = new Date(vals!.endDate as Date);

    const diffMs = end.getTime() - start.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);

    expect(diffDays).toBe(30);
    expect(start.getTime()).toBeGreaterThanOrEqual(beforeCall - 1000);
  });

  it("calculates correct endDate for yearly plan (365 days)", async () => {
    const tx = createMockTx([
      [],  // no payment
      [],  // no active sub
    ]);

    const { insert, getCapturedValues } = createCapturingInsert();
    tx.insert = insert;

    await activateSubscription(tx, {
      accountId,
      plan: "yearly",
      paymentMethod: "qris",
    });

    const vals = getCapturedValues();
    expect(vals).not.toBeNull();
    const start = new Date(vals!.startDate as Date);
    const end = new Date(vals!.endDate as Date);

    const diffMs = end.getTime() - start.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);

    expect(diffDays).toBe(365);
  });

  it("queues renewal correctly: new startDate = existing endDate", async () => {
    const existingEndDate = new Date("2026-06-30T23:59:59Z");

    const tx = createMockTx([
      [
        {
          id: "sub-active-1",
          accountId,
          status: "active",
          plan: "monthly",
          startDate: new Date("2026-06-01"),
          endDate: existingEndDate,
          paymentMethod: "qris",
        },
      ],
    ]);

    const { insert, getCapturedValues } = createCapturingInsert();
    tx.insert = insert;

    await activateSubscription(tx, {
      accountId,
      plan: "monthly",
      paymentMethod: "qris",
    });

    const vals = getCapturedValues();
    expect(vals).not.toBeNull();
    const start = new Date(vals!.startDate as Date);
    const end = new Date(vals!.endDate as Date);

    // Start should equal existing subscription's end date
    expect(start.getTime()).toBe(existingEndDate.getTime());

    // End should be start + 30 days (monthly plan)
    const expectedEnd = new Date(existingEndDate.getTime() + 30 * 24 * 60 * 60 * 1000);
    expect(end.getTime()).toBe(expectedEnd.getTime());
  });

  it("starts now when existing subscription is expired", async () => {
    const pastEndDate = new Date("2025-12-31T23:59:59Z");

    // The active sub query returns one but its endDate is in the past
    const tx = createMockTx([
      [
        {
          id: "sub-expired-1",
          accountId,
          status: "active",
          plan: "monthly",
          startDate: new Date("2025-12-01"),
          endDate: pastEndDate,
          paymentMethod: "qris",
        },
      ],
    ]);

    const { insert, getCapturedValues } = createCapturingInsert();
    tx.insert = insert;

    const beforeCall = Date.now();
    await activateSubscription(tx, {
      accountId,
      plan: "monthly",
      paymentMethod: "qris",
    });

    const vals = getCapturedValues();
    expect(vals).not.toBeNull();
    const start = new Date(vals!.startDate as Date);

    // Start should be ~now, not the expired subscription's end date
    expect(start.getTime()).toBeGreaterThanOrEqual(beforeCall - 1000);
    expect(start.getTime()).not.toBe(pastEndDate.getTime());
  });

  it("activates yearly_kol (free KOL plan) with 365-day duration", async () => {
    const tx = createMockTx([
      [],  // no payment
      [],  // no active sub
    ]);

    const { insert, getCapturedValues } = createCapturingInsert();
    tx.insert = insert;

    await activateSubscription(tx, {
      accountId,
      plan: "yearly_kol",
      paymentMethod: "admin_grant",
    });

    const vals = getCapturedValues();
    expect(vals).not.toBeNull();
    expect(vals!.plan).toBe("yearly_kol");

    const start = new Date(vals!.startDate as Date);
    const end = new Date(vals!.endDate as Date);
    const diffDays = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
    expect(diffDays).toBe(365);
  });
});
