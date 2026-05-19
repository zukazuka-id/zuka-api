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
const planTierEnum = z.enum([
  "monthly",
  "yearly",
  "yearly_early_bird",
  "yearly_kol",
  "yearly_founders",
]);

export const createSubscriptionSchema = z.object({
  plan: z.enum(["monthly", "yearly"]),
});

// Payment Intents
export const createSubscriptionPaymentIntentSchema = z.object({
  plan: planTierEnum.default("yearly"),
});

export const grantSubscriptionSchema = z.object({
  plan: planTierEnum,
  reason: z.string().min(1).max(500),
});

// Redemptions
export const createRedemptionSchema = z.object({
  outletId: z.string().min(1),
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

const queryBoolean = z.preprocess((value) => {
  if (value === "true" || value === true) return true;
  if (value === "false" || value === false) return false;
  return value;
}, z.boolean());

const restaurantStatusEnum = z.enum(["pending", "active", "suspended", "archived"]);

export const adminRestaurantsQuerySchema = listQuerySchema.extend({
  restaurantStatus: restaurantStatusEnum.optional(),
  outletStatus: restaurantStatusEnum.optional(),
  isOpen: queryBoolean.optional(),
  cuisine: z.string().optional(),
  halal: queryBoolean.optional(),
  includeArchived: queryBoolean.optional(),
  // Backward compatibility aliases
  status: restaurantStatusEnum.optional(),
  halalCertified: queryBoolean.optional(),
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
  name: z.string().min(3).max(100).optional(),
  description: z.string().max(2000).optional(),
  cuisineTags: z.array(z.string().min(1).max(50)).max(10).optional(),
  halalCertified: z.boolean().optional(),
  defaultBogoLimit: z.number().int().min(1).max(99).optional(),
  logo: z.string().optional(),
});

const adminRestaurantPhotoSchema = z.object({
  url: z.string().url(),
  label: z.string().max(200).optional(),
  imagekitFileId: z.string().max(200).optional(),
  imagekitUrl: z.string().url().optional(),
  sortOrder: z.number().int().min(0).optional(),
});

const adminRestaurantFieldsSchema = z.object({
  name: z.string().min(3).max(100),
  description: z.string().max(2000).optional(),
  cuisineTags: z.array(z.string().min(1).max(50)).max(10).optional(),
  halalCertified: z.boolean().optional(),
  operatingHours: z.record(z.string(), z.unknown()).optional(),
  whatsappNumber: z.string().max(50).optional(),
  phoneNumber: z.string().max(50).optional(),
  instagramHandle: z.string().max(100).optional(),
  tiktokHandle: z.string().max(100).optional(),
  facebookUrl: z.string().url().optional(),
  defaultBogoLimit: z.number().int().min(1).max(99).optional(),
  defaultAvgTableSpend: z.number().int().positive().optional(),
  photos: z.array(adminRestaurantPhotoSchema).max(10).optional(),
});

export const adminCreateRestaurantSchema = adminRestaurantFieldsSchema.extend({
  status: z.literal("pending").optional(),
});

export const adminUpdateRestaurantSchema = adminRestaurantFieldsSchema.partial().extend({
  name: z.string().min(3).max(100).optional(),
});

const adminOutletPhotoSchema = adminRestaurantPhotoSchema;

const adminOutletFieldsSchema = z.object({
  label: z.string().min(1).max(200),
  address: z.string().min(1).max(500),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  operatingHours: z.record(z.string(), z.unknown()).optional(),
  isOpen: z.boolean().optional(),
  bogoLimit: z.number().int().min(1).max(99).optional(),
  avgTableSpend: z.number().int().positive().optional(),
  whatsappNumber: z.string().max(50).optional(),
  phoneContact: z.string().max(50).optional(),
  instagramHandle: z.string().max(100).optional(),
  status: restaurantStatusEnum.optional(),
  photos: z.array(adminOutletPhotoSchema).max(10).optional(),
});

export const adminCreateOutletSchema = adminOutletFieldsSchema.extend({
  status: restaurantStatusEnum.optional(),
});

export const adminUpdateOutletSchema = adminOutletFieldsSchema.partial().extend({
  label: z.string().min(1).max(200).optional(),
  address: z.string().min(1).max(500).optional(),
});

export const adminManualCloseOutletSchema = z.object({
  reopenStrategy: z.enum(["next_hours", "custom", "indefinite"]),
  customReopenAt: z.string().datetime({ offset: true }).optional(),
}).superRefine((value, ctx) => {
  if (value.reopenStrategy === "custom" && !value.customReopenAt) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "customReopenAt is required when reopenStrategy is custom",
      path: ["customReopenAt"],
    });
  }
});

// Banners
export const createBannerSchema = z.object({
  title: z.string().min(1).max(200),
  imageUrl: z.string().url(),
  linkType: z.enum(["restaurant", "external", "none"]).optional(),
  linkRef: z.string().max(500).optional(),
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }),
  sortOrder: z.number().int().min(0).optional(),
});

export const updateBannerSchema = createBannerSchema.partial();

export const bannerListQuerySchema = z.object({
  includeInactive: queryBoolean.optional(),
});

// Curated lists
export const createCuratedListSchema = z.object({
  title: z.string().min(1).max(200),
  subtitle: z.string().max(300).optional(),
  tag: z.string().max(50).optional(),
  sortOrder: z.number().int().min(0).optional(),
  startsAt: z.string().datetime({ offset: true }).optional(),
  endsAt: z.string().datetime({ offset: true }).optional(),
  restaurantIds: z.array(z.string().min(1)).optional(),
});

export const updateCuratedListSchema = createCuratedListSchema.partial().extend({
  restaurantIds: z.array(z.string().min(1)).optional(),
});

export const curatedListQuerySchema = z.object({
  includeInactive: queryBoolean.optional(),
});

export const addRestaurantToListSchema = z.object({
  restaurantId: z.string().min(1),
  sortOrder: z.number().int().min(0).optional(),
});

// Homepage section query validators
export const sectionLimitSchema = z.object({
  limit: z.coerce.number().int().min(1).max(20).default(10),
});
