import { describe, it, expect } from "vitest";
import {
  PLAN_CONFIGS,
  getSubscriptionPlanConfig,
  isFreePlan,
  type PlanTier,
} from "../../lib/subscription-plans";

describe("subscription-plans", () => {
  describe("PLAN_CONFIGS", () => {
    it("defines all five plan tiers", () => {
      const tiers: PlanTier[] = [
        "monthly",
        "yearly",
        "yearly_early_bird",
        "yearly_kol",
        "yearly_founders",
      ];
      for (const tier of tiers) {
        expect(PLAN_CONFIGS[tier]).toBeDefined();
        expect(PLAN_CONFIGS[tier].plan).toBe(tier);
      }
    });

    it("uses IDR currency for every plan", () => {
      for (const config of Object.values(PLAN_CONFIGS)) {
        expect(config.currency).toBe("IDR");
      }
    });
  });

  describe("yearly plan", () => {
    it("has amount of Rp 475.000", () => {
      expect(PLAN_CONFIGS.yearly.amount).toBe(475_000);
    });

    it("has duration of 365 days", () => {
      expect(PLAN_CONFIGS.yearly.durationDays).toBe(365);
    });

    it("is not a free plan", () => {
      expect(isFreePlan("yearly")).toBe(false);
    });
  });

  describe("monthly plan", () => {
    it("has amount of Rp 49.000", () => {
      expect(PLAN_CONFIGS.monthly.amount).toBe(49_000);
    });

    it("has duration of 30 days", () => {
      expect(PLAN_CONFIGS.monthly.durationDays).toBe(30);
    });

    it("is not a free plan", () => {
      expect(isFreePlan("monthly")).toBe(false);
    });
  });

  describe("yearly_early_bird plan", () => {
    it("has amount of Rp 299.000", () => {
      expect(PLAN_CONFIGS.yearly_early_bird.amount).toBe(299_000);
    });

    it("has duration of 365 days", () => {
      expect(PLAN_CONFIGS.yearly_early_bird.durationDays).toBe(365);
    });

    it("is not a free plan", () => {
      expect(isFreePlan("yearly_early_bird")).toBe(false);
    });
  });

  describe("zero-amount (free) plans", () => {
    it("yearly_kol has amount 0 and is a free plan", () => {
      expect(PLAN_CONFIGS.yearly_kol.amount).toBe(0);
      expect(isFreePlan("yearly_kol")).toBe(true);
    });

    it("yearly_founders has amount 0 and is a free plan", () => {
      expect(PLAN_CONFIGS.yearly_founders.amount).toBe(0);
      expect(isFreePlan("yearly_founders")).toBe(true);
    });

    it("free plans still have 365-day duration", () => {
      expect(PLAN_CONFIGS.yearly_kol.durationDays).toBe(365);
      expect(PLAN_CONFIGS.yearly_founders.durationDays).toBe(365);
    });
  });

  describe("getSubscriptionPlanConfig", () => {
    it("returns correct config for each tier", () => {
      const tiers: PlanTier[] = [
        "monthly",
        "yearly",
        "yearly_early_bird",
        "yearly_kol",
        "yearly_founders",
      ];
      for (const tier of tiers) {
        const config = getSubscriptionPlanConfig(tier);
        expect(config).toEqual(PLAN_CONFIGS[tier]);
      }
    });
  });

  describe("isFreePlan", () => {
    it("returns false for paid plans", () => {
      expect(isFreePlan("monthly")).toBe(false);
      expect(isFreePlan("yearly")).toBe(false);
      expect(isFreePlan("yearly_early_bird")).toBe(false);
    });

    it("returns true for zero-amount plans", () => {
      expect(isFreePlan("yearly_kol")).toBe(true);
      expect(isFreePlan("yearly_founders")).toBe(true);
    });
  });
});
