export type PlanTier =
  | "monthly"
  | "yearly"
  | "yearly_early_bird"
  | "yearly_kol"
  | "yearly_founders"
  | "reviewer";

export type PlanConfig = {
  plan: PlanTier;
  amount: number; // 0 = free/gratis, skip QRIS
  currency: "IDR";
  durationDays: number;
  label: string;
};

export const PLAN_CONFIGS: Record<PlanTier, PlanConfig> = {
  monthly: {
    plan: "monthly",
    amount: 49_000,
    currency: "IDR",
    durationDays: 30,
    label: "Bulanan",
  },
  yearly: {
    plan: "yearly",
    amount: 475_000,
    currency: "IDR",
    durationDays: 365,
    label: "Tahunan",
  },
  yearly_early_bird: {
    plan: "yearly_early_bird",
    amount: 299_000,
    currency: "IDR",
    durationDays: 365,
    label: "Early Bird",
  },
  yearly_kol: {
    plan: "yearly_kol",
    amount: 0,
    currency: "IDR",
    durationDays: 365,
    label: "KOL Partner",
  },
  yearly_founders: {
    plan: "yearly_founders",
    amount: 0,
    currency: "IDR",
    durationDays: 365,
    label: "Founders",
  },
  reviewer: {
    plan: "reviewer",
    amount: 1,
    currency: "IDR",
    durationDays: 1,
    label: "App Review",
  },
};

export function getSubscriptionPlanConfig(plan: PlanTier): PlanConfig {
  return PLAN_CONFIGS[plan];
}

export function isFreePlan(plan: PlanTier): boolean {
  return PLAN_CONFIGS[plan].amount === 0;
}
