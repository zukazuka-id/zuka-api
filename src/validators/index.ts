import { z } from "zod";

// Auth
export const registerSchema = z.object({
  phoneNumber: z.string().min(8).max(15),
});

export const verifyOtpSchema = z.object({
  phoneNumber: z.string().min(8).max(15),
  code: z.string().length(6),
  inviteCode: z.string().min(1).max(20).optional(),
});

export const merchantLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

export const merchantRegisterSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  password: z.string().min(6),
});

// Subscription
export const createSubscriptionSchema = z.object({
  plan: z.enum(["monthly", "annual"]),
});

// Redemptions
export const createRedemptionSchema = z.object({
  outletId: z.string().uuid(),
});

export const verifyRedemptionSchema = z.object({
  qrToken: z.string().min(1),
});

// Invites
export const generateInvitesSchema = z.object({
  count: z.number().int().min(1).max(10).optional().default(1),
});

export const validateInviteSchema = z.object({
  code: z.string().min(1).max(20),
});

// Merchant
const outletStatusEnum = z.enum(["active", "pending", "suspended"]);

export const updateOutletSchema = z.object({
  label: z.string().min(1).max(200).optional(),
  address: z.string().min(1).max(500).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  operatingHours: z.record(z.string(), z.unknown()).optional(),
  isOpen: z.boolean().optional(),
  bogoLimit: z.number().int().min(0).optional(),
  whatsappNumber: z.string().optional(),
  phoneContact: z.string().optional(),
  instagramHandle: z.string().optional(),
  status: outletStatusEnum.optional(),
});

// Admin
export const adminCreateInvitesSchema = z.object({
  referrerId: z.string().min(1),
  count: z.number().int().min(1).max(100).default(1),
  expiresDays: z.number().int().min(1).max(365).default(30),
  type: z.enum(["single_use", "multi_use"]).default("single_use"),
  maxRedemptions: z.number().int().min(1).nullable().default(null),
});

export const updateRestaurantSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  cuisineTags: z.array(z.string()).optional(),
  halalCertified: z.boolean().optional(),
  logo: z.string().optional(),
});
