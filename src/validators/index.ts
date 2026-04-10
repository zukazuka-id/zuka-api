import { z } from "zod";

// Auth
export const registerSchema = z.object({
  phoneNumber: z.string().min(8).max(15),
});

export const registerDeviceSchema = z.object({
  token: z.string().min(10).max(500),
  platform: z.enum(["ios", "android", "web"]),
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
  plan: z.enum(["monthly", "yearly"]),
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

// Nearby restaurants query
export const nearbyQuerySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  radius: z.coerce.number().min(0.1).max(50).default(10),
});

// Admin list query params
export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().max(200).optional(),
});

export const adminMembersQuerySchema = listQuerySchema.extend({
  status: z.enum(["verified", "unverified"]).optional(),
});

export const adminRestaurantsQuerySchema = listQuerySchema.extend({
  status: z.enum(["active", "pending", "suspended"]).optional(),
  cuisine: z.string().optional(),
});

export const adminRedemptionsQuerySchema = listQuerySchema.extend({
  memberId: z.string().min(1).optional(),
  outletId: z.string().min(1).optional(),
  status: z.enum(["pending", "confirmed", "cancelled"]).optional(),
  startDate: z.string().datetime({ offset: true }).optional(),
  endDate: z.string().datetime({ offset: true }).optional(),
});

export const adminInvitesQuerySchema = listQuerySchema.extend({
  status: z.enum(["active", "inactive"]).optional(),
  referrerId: z.string().min(1).optional(),
});

export const adminCreateInvitesSchema = z.object({
  referrerId: z.string().min(1),
  count: z.number().int().min(1).max(100).default(1),
  expiresDays: z.number().int().min(1).max(365).default(30),
  type: z.enum(["single_use", "multi_use"]).default("single_use"),
  maxRedemptions: z.number().int().min(1).nullable().default(null),
});

// Platform Config
export const configQuerySchema = z.object({
  key: z.string().min(1).max(100),
});

export const adminConfigUpsertSchema = z.object({
  key: z.string().min(1).max(100),
  value: z.string().min(1).max(1000),
  isPublic: z.boolean().optional(),
});

export const updateRestaurantSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  cuisineTags: z.array(z.string()).optional(),
  halalCertified: z.boolean().optional(),
  logo: z.string().optional(),
});
