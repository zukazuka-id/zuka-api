/**
 * OpenAPI route definitions for documentation.
 * These mirror the actual routes in src/routes/ but provide OpenAPI metadata.
 * Uses OpenAPIHono internally to generate the spec.
 */
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import {
  RegisterRequestSchema,
  VerifyOTPRequestSchema,
  MerchantLoginRequestSchema,
  MerchantRegisterRequestSchema,
  ForgotPasswordRequestSchema,
  UserMeSchema,
  ErrorSchema,
  SuccessSchema,
  PaginatedSchema,
  RestaurantListItemSchema,
  RestaurantSearchItemSchema,
  RestaurantDetailSchema,
  CreateRedemptionRequestSchema,
  VerifyRedemptionRequestSchema,
  RedemptionCreatedSchema,
  RedemptionVerifiedSchema,
  RedemptionHistoryItemSchema,
  RedemptionTodayItemSchema,
  CreateSubscriptionRequestSchema,
  SubscriptionCreatedSchema,
  SubscriptionStatusSchema,
  GenerateInviteRequestSchema,
  InviteCodeSchema,
  RedeemInviteRequestSchema,
  ResolveMapsRequestSchema,
  ResolveMapsResponseSchema,
  DashboardSchema,
  OutletSchema,
} from "@/lib/openapi";

// This Hono app is only used for OpenAPI spec generation, not for actual routing
const docsApp = new OpenAPIHono();

// ── Auth Routes ──────────────────────────────────────────────

docsApp.openapi(
  createRoute({
    method: "post",
    path: "/api/v1/auth/register",
    tags: ["Auth"],
    summary: "Register with phone number",
    description: "Send OTP to the given phone number for registration",
    request: { body: { content: { "application/json": { schema: RegisterRequestSchema } } } },
    responses: {
      200: { description: "OTP sent", content: { "application/json": { schema: SuccessSchema(z.object({ message: z.string(), result: z.any() })) } } },
      400: { description: "Validation error", content: { "application/json": { schema: ErrorSchema } } },
    },
  }),
  async (c: any) => c.json({ success: true, data: { message: "See actual API" } })
);

docsApp.openapi(
  createRoute({
    method: "post",
    path: "/api/v1/auth/verify-otp",
    tags: ["Auth"],
    summary: "Verify OTP code",
    description: "Verify OTP and create/return member account",
    request: { body: { content: { "application/json": { schema: VerifyOTPRequestSchema } } } },
    responses: {
      200: { description: "Verified", content: { "application/json": { schema: SuccessSchema(z.any()) } } },
      400: { description: "Validation error", content: { "application/json": { schema: ErrorSchema } } },
    },
  }),
  async (c: any) => c.json({ success: true, data: {} })
);

docsApp.openapi(
  createRoute({
    method: "post",
    path: "/api/v1/auth/merchant/login",
    tags: ["Auth"],
    summary: "Merchant login",
    description: "Login with email and password for merchant accounts",
    request: { body: { content: { "application/json": { schema: MerchantLoginRequestSchema } } } },
    responses: {
      200: { description: "Login successful", content: { "application/json": { schema: SuccessSchema(z.any()) } } },
      400: { description: "Validation error", content: { "application/json": { schema: ErrorSchema } } },
    },
  }),
  async (c: any) => c.json({ success: true, data: {} })
);

docsApp.openapi(
  createRoute({
    method: "post",
    path: "/api/v1/auth/merchant/register",
    tags: ["Auth"],
    summary: "Register merchant account",
    description: "Create a new merchant account with email and password",
    request: { body: { content: { "application/json": { schema: MerchantRegisterRequestSchema } } } },
    responses: {
      201: { description: "Registered", content: { "application/json": { schema: SuccessSchema(z.any()) } } },
      400: { description: "Validation error", content: { "application/json": { schema: ErrorSchema } } },
    },
  }),
  async (c: any) => c.json({ success: true, data: {} }, 201)
);

docsApp.openapi(
  createRoute({
    method: "post",
    path: "/api/v1/auth/merchant/forgot-password",
    tags: ["Auth"],
    summary: "Forgot password",
    description: "Request password reset email",
    request: { body: { content: { "application/json": { schema: ForgotPasswordRequestSchema } } } },
    responses: {
      200: { description: "Reset email sent", content: { "application/json": { schema: SuccessSchema(z.object({ message: z.string() })) } } },
      400: { description: "Validation error", content: { "application/json": { schema: ErrorSchema } } },
    },
  }),
  async (c: any) => c.json({ success: true, data: {} })
);

docsApp.openapi(
  createRoute({
    method: "get",
    path: "/api/v1/auth/me",
    tags: ["Auth"],
    summary: "Get current user",
    description: "Return authenticated user info with roles",
    security: [{ bearerAuth: [] }],
    responses: {
      200: { description: "User info", content: { "application/json": { schema: SuccessSchema(UserMeSchema) } } },
      401: { description: "Unauthorized", content: { "application/json": { schema: ErrorSchema } } },
    },
  }),
  async (c: any) => c.json({ success: true, data: {} })
);

docsApp.openapi(
  createRoute({
    method: "post",
    path: "/api/v1/auth/logout",
    tags: ["Auth"],
    summary: "Logout",
    description: "Sign out the current session",
    security: [{ bearerAuth: [] }],
    responses: {
      200: { description: "Logged out", content: { "application/json": { schema: SuccessSchema(z.object({ message: z.string() })) } } },
      401: { description: "Unauthorized", content: { "application/json": { schema: ErrorSchema } } },
    },
  }),
  async (c: any) => c.json({ success: true, data: {} })
);

// ── Restaurant Routes ────────────────────────────────────────

docsApp.openapi(
  createRoute({
    method: "get",
    path: "/api/v1/restaurants/discover",
    tags: ["Restaurants"],
    summary: "Discover restaurants",
    description: "Browse restaurants with optional cuisine filter. Returns restaurants grouped by outlets.",
    request: {
      query: z.object({
        cuisine: z.string().optional().openapi({ description: "Filter by cuisine tag" }),
        page: z.string().optional().openapi({ description: "Page number (default: 1)" }),
        limit: z.string().optional().openapi({ description: "Items per page, max 50 (default: 20)" }),
      }),
    },
    responses: {
      200: { description: "Paginated restaurants", content: { "application/json": { schema: PaginatedSchema(RestaurantListItemSchema) } } },
    },
  }),
  async (c: any) => c.json({ success: true, data: [] })
);

docsApp.openapi(
  createRoute({
    method: "get",
    path: "/api/v1/restaurants/search",
    tags: ["Restaurants"],
    summary: "Search restaurants",
    description: "Search restaurants by name, cuisine, or description",
    request: { query: z.object({ q: z.string().openapi({ description: "Search query" }) }) },
    responses: {
      200: { description: "Search results", content: { "application/json": { schema: SuccessSchema(z.array(RestaurantSearchItemSchema)) } } },
      400: { description: "Missing query", content: { "application/json": { schema: ErrorSchema } } },
    },
  }),
  async (c: any) => c.json({ success: true, data: [] })
);

docsApp.openapi(
  createRoute({
    method: "get",
    path: "/api/v1/restaurants/{id}",
    tags: ["Restaurants"],
    summary: "Get restaurant detail",
    description: "Get full restaurant info including outlets and photos",
    request: { params: z.object({ id: z.string().openapi({ description: "Restaurant ID" }) }) },
    responses: {
      200: { description: "Restaurant detail", content: { "application/json": { schema: SuccessSchema(RestaurantDetailSchema) } } },
      404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
    },
  }),
  async (c: any) => c.json({ success: true, data: {} })
);

// ── Redemption Routes ────────────────────────────────────────

docsApp.openapi(
  createRoute({
    method: "post",
    path: "/api/v1/redemptions/create",
    tags: ["Redemptions"],
    summary: "Create redemption",
    description: "Member creates a BOGO redemption QR code at a specific outlet. Requires active subscription.",
    security: [{ bearerAuth: [] }],
    request: { body: { content: { "application/json": { schema: CreateRedemptionRequestSchema } } } },
    responses: {
      201: { description: "Redemption created", content: { "application/json": { schema: SuccessSchema(RedemptionCreatedSchema) } } },
      400: { description: "Validation error", content: { "application/json": { schema: ErrorSchema } } },
      403: { description: "Subscription required", content: { "application/json": { schema: ErrorSchema } } },
      409: { description: "Already redeemed this year", content: { "application/json": { schema: ErrorSchema } } },
    },
  }),
  async (c: any) => c.json({ success: true, data: {} }, 201)
);

docsApp.openapi(
  createRoute({
    method: "post",
    path: "/api/v1/redemptions/verify",
    tags: ["Redemptions"],
    summary: "Verify redemption QR",
    description: "Merchant scans and verifies a redemption QR code. Requires staff/manager/owner role.",
    security: [{ bearerAuth: [] }],
    request: { body: { content: { "application/json": { schema: VerifyRedemptionRequestSchema } } } },
    responses: {
      200: { description: "Redemption verified", content: { "application/json": { schema: SuccessSchema(RedemptionVerifiedSchema) } } },
      400: { description: "Validation error", content: { "application/json": { schema: ErrorSchema } } },
      404: { description: "Invalid QR token", content: { "application/json": { schema: ErrorSchema } } },
      409: { description: "Already redeemed", content: { "application/json": { schema: ErrorSchema } } },
      410: { description: "QR code expired", content: { "application/json": { schema: ErrorSchema } } },
    },
  }),
  async (c: any) => c.json({ success: true, data: {} })
);

docsApp.openapi(
  createRoute({
    method: "get",
    path: "/api/v1/redemptions/my",
    tags: ["Redemptions"],
    summary: "My redemption history",
    description: "Get the authenticated member's redemption history with optional status filter",
    security: [{ bearerAuth: [] }],
    request: {
      query: z.object({
        status: z.string().optional().openapi({ description: "Filter by status (pending, confirmed, expired)" }),
        page: z.string().optional().openapi({ description: "Page number (default: 1)" }),
        limit: z.string().optional().openapi({ description: "Items per page, max 50 (default: 20)" }),
      }),
    },
    responses: {
      200: { description: "Redemption history", content: { "application/json": { schema: PaginatedSchema(RedemptionHistoryItemSchema) } } },
      401: { description: "Unauthorized", content: { "application/json": { schema: ErrorSchema } } },
    },
  }),
  async (c: any) => c.json({ success: true, data: [] })
);

docsApp.openapi(
  createRoute({
    method: "get",
    path: "/api/v1/redemptions/today",
    tags: ["Redemptions"],
    summary: "Today's redemptions",
    description: "Get today's redemptions for a specific outlet. Requires staff/manager/owner role.",
    security: [{ bearerAuth: [] }],
    request: { query: z.object({ outletId: z.string().optional().openapi({ description: "Outlet ID (defaults to first assigned outlet)" }) }) },
    responses: {
      200: { description: "Today's redemptions", content: { "application/json": { schema: SuccessSchema(z.array(RedemptionTodayItemSchema)) } } },
      400: { description: "Missing outletId", content: { "application/json": { schema: ErrorSchema } } },
      401: { description: "Unauthorized", content: { "application/json": { schema: ErrorSchema } } },
    },
  }),
  async (c: any) => c.json({ success: true, data: [] })
);

// ── Subscription Routes ──────────────────────────────────────

docsApp.openapi(
  createRoute({
    method: "post",
    path: "/api/v1/subscription/create",
    tags: ["Subscription"],
    summary: "Create subscription",
    description: "Create a new subscription (monthly or annual). Requires authentication.",
    security: [{ bearerAuth: [] }],
    request: { body: { content: { "application/json": { schema: CreateSubscriptionRequestSchema } } } },
    responses: {
      201: { description: "Subscription created", content: { "application/json": { schema: SuccessSchema(SubscriptionCreatedSchema) } } },
      401: { description: "Unauthorized", content: { "application/json": { schema: ErrorSchema } } },
      409: { description: "Already subscribed", content: { "application/json": { schema: ErrorSchema } } },
    },
  }),
  async (c: any) => c.json({ success: true, data: {} }, 201)
);

docsApp.openapi(
  createRoute({
    method: "get",
    path: "/api/v1/subscription/status",
    tags: ["Subscription"],
    summary: "Get subscription status",
    description: "Get the authenticated user's subscription status",
    security: [{ bearerAuth: [] }],
    responses: {
      200: { description: "Subscription status", content: { "application/json": { schema: SuccessSchema(SubscriptionStatusSchema) } } },
      401: { description: "Unauthorized", content: { "application/json": { schema: ErrorSchema } } },
    },
  }),
  async (c: any) => c.json({ success: true, data: {} })
);

// ── Invite Routes ────────────────────────────────────────────

docsApp.openapi(
  createRoute({
    method: "post",
    path: "/api/v1/invites/generate",
    tags: ["Invites"],
    summary: "Generate invite codes",
    description: "Generate invite codes for sharing. Requires active subscription.",
    security: [{ bearerAuth: [] }],
    request: { body: { content: { "application/json": { schema: GenerateInviteRequestSchema } } } },
    responses: {
      201: { description: "Invite codes generated", content: { "application/json": { schema: SuccessSchema(z.array(InviteCodeSchema)) } } },
      401: { description: "Unauthorized", content: { "application/json": { schema: ErrorSchema } } },
      403: { description: "Subscription required", content: { "application/json": { schema: ErrorSchema } } },
    },
  }),
  async (c: any) => c.json({ success: true, data: [] }, 201)
);

docsApp.openapi(
  createRoute({
    method: "post",
    path: "/api/v1/invites/redeem",
    tags: ["Invites"],
    summary: "Redeem invite code",
    description: "Redeem an invite code. No authentication required.",
    request: { body: { content: { "application/json": { schema: RedeemInviteRequestSchema } } } },
    responses: {
      200: { description: "Invite redeemed", content: { "application/json": { schema: SuccessSchema(z.object({ message: z.string(), code: z.string(), redeemedAt: z.string() })) } } },
      400: { description: "Invalid or inactive code", content: { "application/json": { schema: ErrorSchema } } },
      404: { description: "Code not found", content: { "application/json": { schema: ErrorSchema } } },
      410: { description: "Code expired", content: { "application/json": { schema: ErrorSchema } } },
    },
  }),
  async (c: any) => c.json({ success: true, data: {} })
);

// ── Outlet Routes ────────────────────────────────────────────

docsApp.openapi(
  createRoute({
    method: "post",
    path: "/api/v1/outlets/resolve-maps-link",
    tags: ["Outlets"],
    summary: "Resolve Google Maps link",
    description: "Resolve a Google Maps short URL to latitude/longitude coordinates",
    request: { body: { content: { "application/json": { schema: ResolveMapsRequestSchema } } } },
    responses: {
      200: { description: "Resolved coordinates", content: { "application/json": { schema: SuccessSchema(ResolveMapsResponseSchema) } } },
      400: { description: "URL required", content: { "application/json": { schema: ErrorSchema } } },
    },
  }),
  async (c: any) => c.json({ success: true, data: {} })
);

// ── Merchant Routes ──────────────────────────────────────────

docsApp.openapi(
  createRoute({
    method: "get",
    path: "/api/v1/merchant/dashboard",
    tags: ["Merchant"],
    summary: "Merchant dashboard",
    description: "Get dashboard stats for the merchant's outlet. Requires staff/manager/owner role.",
    security: [{ bearerAuth: [] }],
    request: { query: z.object({ outletId: z.string().optional().openapi({ description: "Outlet ID (defaults to first assigned outlet)" }) }) },
    responses: {
      200: { description: "Dashboard data", content: { "application/json": { schema: SuccessSchema(DashboardSchema) } } },
      400: { description: "Missing outletId", content: { "application/json": { schema: ErrorSchema } } },
      401: { description: "Unauthorized", content: { "application/json": { schema: ErrorSchema } } },
    },
  }),
  async (c: any) => c.json({ success: true, data: {} })
);

docsApp.openapi(
  createRoute({
    method: "get",
    path: "/api/v1/merchant/outlet/{id}",
    tags: ["Merchant"],
    summary: "Get outlet detail",
    description: "Get outlet info. Must have access to the outlet.",
    security: [{ bearerAuth: [] }],
    request: { params: z.object({ id: z.string().openapi({ description: "Outlet ID" }) }) },
    responses: {
      200: { description: "Outlet detail", content: { "application/json": { schema: SuccessSchema(OutletSchema) } } },
      401: { description: "Unauthorized", content: { "application/json": { schema: ErrorSchema } } },
      403: { description: "No access", content: { "application/json": { schema: ErrorSchema } } },
      404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
    },
  }),
  async (c: any) => c.json({ success: true, data: {} })
);

docsApp.openapi(
  createRoute({
    method: "put",
    path: "/api/v1/merchant/outlet/{id}",
    tags: ["Merchant"],
    summary: "Update outlet",
    description: "Update outlet fields. Owner or manager role required.",
    security: [{ bearerAuth: [] }],
    request: {
      params: z.object({ id: z.string().openapi({ description: "Outlet ID" }) }),
      body: {
        content: {
          "application/json": {
            schema: z.object({
              label: z.string().optional(),
              address: z.string().optional(),
              lat: z.number().optional(),
              lng: z.number().optional(),
              operatingHours: z.any().optional(),
              isOpen: z.boolean().optional(),
              bogoLimit: z.number().optional(),
              whatsappNumber: z.string().optional(),
              phoneContact: z.string().optional(),
              instagramHandle: z.string().optional(),
              status: z.string().optional(),
            }),
          },
        },
      },
    },
    responses: {
      200: { description: "Outlet updated", content: { "application/json": { schema: SuccessSchema(OutletSchema) } } },
      400: { description: "No fields to update", content: { "application/json": { schema: ErrorSchema } } },
      401: { description: "Unauthorized", content: { "application/json": { schema: ErrorSchema } } },
      403: { description: "Insufficient role", content: { "application/json": { schema: ErrorSchema } } },
    },
  }),
  async (c: any) => c.json({ success: true, data: {} })
);

docsApp.openapi(
  createRoute({
    method: "get",
    path: "/api/v1/merchant/restaurant/{id}",
    tags: ["Merchant"],
    summary: "Get restaurant detail (merchant)",
    description: "Get restaurant info. Owner role required.",
    security: [{ bearerAuth: [] }],
    request: { params: z.object({ id: z.string().openapi({ description: "Restaurant ID" }) }) },
    responses: {
      200: { description: "Restaurant detail", content: { "application/json": { schema: SuccessSchema(RestaurantDetailSchema) } } },
      401: { description: "Unauthorized", content: { "application/json": { schema: ErrorSchema } } },
      403: { description: "Not owner", content: { "application/json": { schema: ErrorSchema } } },
      404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
    },
  }),
  async (c: any) => c.json({ success: true, data: {} })
);

docsApp.openapi(
  createRoute({
    method: "put",
    path: "/api/v1/merchant/restaurant/{id}",
    tags: ["Merchant"],
    summary: "Update restaurant",
    description: "Update restaurant fields. Owner role required.",
    security: [{ bearerAuth: [] }],
    request: {
      params: z.object({ id: z.string().openapi({ description: "Restaurant ID" }) }),
      body: {
        content: {
          "application/json": {
            schema: z.object({
              name: z.string().optional(),
              description: z.string().optional(),
              cuisineTags: z.array(z.string()).optional(),
              halalCertified: z.boolean().optional(),
              logo: z.string().optional(),
            }),
          },
        },
      },
    },
    responses: {
      200: { description: "Restaurant updated", content: { "application/json": { schema: SuccessSchema(RestaurantDetailSchema) } } },
      400: { description: "No fields to update", content: { "application/json": { schema: ErrorSchema } } },
      401: { description: "Unauthorized", content: { "application/json": { schema: ErrorSchema } } },
      403: { description: "Not owner", content: { "application/json": { schema: ErrorSchema } } },
    },
  }),
  async (c: any) => c.json({ success: true, data: {} })
);

export { docsApp };
