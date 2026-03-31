import { createRoute, z } from "@hono/zod-openapi";

// ── Shared types ──────────────────────────────────────────────

type UserVars = {
  user: { id: string; name: string; email: string; [key: string]: unknown };
  session: { id: string; token: string; [key: string]: unknown };
  userRoles: { role: string; outletId: string }[];
};

// ── Reusable schemas ──────────────────────────────────────────

export const ErrorSchema = z.object({
  success: z.literal(false),
  error: z.object({
    code: z.string().openapi({ description: "Error code" }),
    message: z.string().openapi({ description: "Error message" }),
  }),
});

export const SuccessSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.object({
    success: z.literal(true),
    data: dataSchema,
  });

export const PaginatedSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.object({
    success: z.literal(true),
    data: z.array(dataSchema),
    pagination: z.object({
      page: z.number(),
      limit: z.number(),
      total: z.number(),
      totalPages: z.number(),
      hasMore: z.boolean(),
    }),
  });

// ── Auth schemas ──────────────────────────────────────────────

export const RegisterRequestSchema = z.object({
  phoneNumber: z.string().openapi({ description: "Phone number in international format", example: "+6281234567890" }),
});

export const VerifyOTPRequestSchema = z.object({
  phoneNumber: z.string().openapi({ description: "Phone number", example: "+6281234567890" }),
  code: z.string().openapi({ description: "OTP code", example: "123456" }),
});

export const MerchantLoginRequestSchema = z.object({
  email: z.string().email().openapi({ description: "Merchant email", example: "merchant@example.com" }),
  password: z.string().openapi({ description: "Password" }),
});

export const MerchantRegisterRequestSchema = z.object({
  name: z.string().openapi({ description: "Full name" }),
  email: z.string().email().openapi({ description: "Email address" }),
  password: z.string().openapi({ description: "Password" }),
});

export const ForgotPasswordRequestSchema = z.object({
  email: z.string().email().openapi({ description: "Email address" }),
});

export const UserRoleSchema = z.object({
  role: z.string(),
  outletId: z.string(),
  outletLabel: z.string().nullable(),
});

export const UserMeSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  phoneNumber: z.string().nullable(),
  roles: z.array(UserRoleSchema),
});

// ── Restaurant schemas ────────────────────────────────────────

export const OutletSchema = z.object({
  id: z.string(),
  label: z.string(),
  address: z.string().nullable(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  isOpen: z.boolean(),
  bogoLimit: z.number().nullable(),
  avgTableSpend: z.number().nullable(),
});

export const RestaurantListItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  cuisineTags: z.array(z.string()).nullable(),
  halalCertified: z.boolean().nullable(),
  logo: z.string().nullable(),
  outlets: z.array(OutletSchema),
});

export const RestaurantSearchItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  cuisineTags: z.array(z.string()).nullable(),
  halalCertified: z.boolean().nullable(),
});

export const RestaurantPhotoSchema = z.object({
  id: z.string(),
  url: z.string().nullable(),
  outletId: z.string(),
});

export const RestaurantDetailSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  cuisineTags: z.array(z.string()).nullable(),
  halalCertified: z.boolean().nullable(),
  logo: z.string().nullable(),
  outlets: z.array(OutletSchema.merge(z.object({ photos: z.array(RestaurantPhotoSchema) }))),
});

// ── Redemption schemas ────────────────────────────────────────

export const CreateRedemptionRequestSchema = z.object({
  outletId: z.string().openapi({ description: "Outlet ID to redeem at" }),
});

export const VerifyRedemptionRequestSchema = z.object({
  qrToken: z.string().openapi({ description: "QR token from redemption" }),
});

export const RedemptionCreatedSchema = z.object({
  id: z.string(),
  qrToken: z.string(),
  expiresAt: z.string(),
});

export const RedemptionVerifiedSchema = z.object({
  redemption: z.object({
    id: z.string(),
    qrToken: z.string(),
    status: z.string(),
    redeemedAt: z.date().nullable(),
    createdAt: z.date(),
    accountId: z.string(),
    outletId: z.string(),
  }),
  member: z.object({ name: z.string() }),
  outlet: z.object({ label: z.string() }),
});

export const RedemptionHistoryItemSchema = z.object({
  id: z.string(),
  qrToken: z.string(),
  status: z.string(),
  redeemedAt: z.date().nullable(),
  createdAt: z.date(),
  outletLabel: z.string().nullable(),
  outletAddress: z.string().nullable(),
});

export const RedemptionTodayItemSchema = z.object({
  id: z.string(),
  qrToken: z.string(),
  status: z.string(),
  redeemedAt: z.date().nullable(),
  createdAt: z.date(),
  memberName: z.string().nullable(),
});

// ── Subscription schemas ──────────────────────────────────────

export const CreateSubscriptionRequestSchema = z.object({
  plan: z.enum(["monthly", "annual"]).optional().default("annual").openapi({ description: "Subscription plan" }),
});

export const SubscriptionCreatedSchema = z.object({
  subscriptionId: z.string(),
  amount: z.number(),
  plan: z.string(),
  paymentMethod: z.string(),
  paymentUrl: z.string(),
});

export const SubscriptionStatusSchema = z.object({
  hasSubscription: z.boolean(),
  id: z.string().optional(),
  plan: z.string().optional(),
  status: z.string().optional(),
  startDate: z.date().optional(),
  endDate: z.date().optional(),
  daysRemaining: z.number().nullable().optional(),
});

// ── Invite schemas ────────────────────────────────────────────

export const GenerateInviteRequestSchema = z.object({
  count: z.number().min(1).max(10).optional().default(1).openapi({ description: "Number of codes to generate (1-10)" }),
});

export const InviteCodeSchema = z.object({
  id: z.string(),
  code: z.string(),
});

export const RedeemInviteRequestSchema = z.object({
  code: z.string().openapi({ description: "Invite code to redeem" }),
});

// ── Outlet schemas ────────────────────────────────────────────

export const ResolveMapsRequestSchema = z.object({
  url: z.string().url().openapi({ description: "Google Maps URL to resolve" }),
});

export const ResolveMapsResponseSchema = z.object({
  originalUrl: z.string(),
  lat: z.number(),
  lng: z.number(),
  resolved: z.boolean(),
  note: z.string(),
});

// ── Merchant schemas ──────────────────────────────────────────

export const DashboardSchema = z.object({
  todayScans: z.number(),
  weekScans: z.number(),
  totalRedemptions: z.number(),
  recentRedemptions: z.array(RedemptionTodayItemSchema),
});

export { type UserVars, createRoute };
