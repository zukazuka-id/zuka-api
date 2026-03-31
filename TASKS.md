# ZUKA API — Task Queue for Claude Code

## INSTRUCTIONS
Read this file and execute ALL tasks below in order. Do NOT stop between tasks. After completing each task, update its status to [x] and immediately proceed to the next one.

Before starting, use Context7 MCP to fetch latest docs:
- `mcporter call context7.resolve-library-id libraryName="drizzle-orm" query="postgresql schema setup with drizzle ORM"` 
- `mcporter call context7.resolve-library-id libraryName="better-auth" query="setup better auth with phone OTP email password RBAC"`
- `mcporter call context7.resolve-library-id libraryName="hono" query="hono API routes middleware authentication"`
Then use `mcporter call context7.query-docs` for each to get setup code examples.

After getting docs, proceed with tasks:

---

## Task 2: Setup Supabase Connection with Drizzle ORM
**Status:** [x] DONE

1. Create `src/lib/db.ts` — Drizzle PostgreSQL client using connection string from DATABASE_URL env var
2. Create `drizzle.config.ts` — Drizzle Kit configuration
3. Create `.env` file (copy from .env.example) and ask user for Supabase DATABASE_URL
4. Add a `/db-test` endpoint in `src/index.ts` that runs `SELECT 1` and returns success
5. Verify: `pnpm dev` → `curl localhost:3001/db-test` returns OK

Wait for user to provide DATABASE_URL if .env doesn't have it yet. If .env already has a real connection string, proceed immediately.

---

## Task 3: DB Schema — Core Entities
**Status:** [x] DONE

Create `src/db/schema/` with these files based on PRD Appendix B data model:

### `src/db/schema/restaurant.ts`
- Table: restaurant
  - id: uuid (PK, default gen_random_uuid())
  - name: text (NOT NULL)
  - description: text (max 500 chars)
  - cuisineTags: text[] (array)
  - halalCertified: boolean (default false)
  - logo: text (nullable)
  - createdAt: timestamp (default now())
- Relations: hasMany(outlet), hasMany(accountRole)

### `src/db/schema/outlet.ts`
- Table: outlet
  - id: uuid (PK)
  - restaurantId: uuid (FK → restaurant.id)
  - label: text (NOT NULL) e.g. "Cabang Kemang"
  - address: text (NOT NULL)
  - lat: double precision
  - lng: double precision
  - operatingHours: jsonb (per-day schedule)
  - isOpen: boolean (default true)
  - bogoLimit: integer (default 1, min 1 max 99)
  - avgTableSpend: integer (Rupiah)
  - whatsappNumber: text (nullable)
  - phoneContact: text (nullable)
  - instagramHandle: text (nullable)
  - status: text (default 'active', check: active|pending|suspended)
  - joinedDate: date (default now())
  - createdAt: timestamp (default now())
  - Post-MVP fields: reservationsEnabled (boolean), maxReservationsPerSlot (int), maxPartySize (int), advanceBookingDays (int)
- Relations: belongsTo(restaurant), hasMany(accountRole), hasMany(photo)

### `src/db/schema/account.ts`
- Table: account
  - id: uuid (PK)
  - name: text
  - phone: text (unique, +62 format)
  - email: text (unique, nullable)
  - passwordHash: text (nullable — merchants have password, members may not)
  - type: text (default 'member', check: member|merchant)
  - createdAt: timestamp (default now())

### `src/db/schema/account-role.ts`
- Table: account_role
  - accountId: uuid (FK → account.id)
  - outletId: uuid (FK → outlet.id)
  - role: text (check: owner|manager|staff)
  - PK: composite (accountId, outletId)

### `src/db/schema/restaurant-photo.ts`
- Table: restaurant_photo
  - id: text (PK)
  - url: text (NOT NULL)
  - label: text
  - outletId: uuid (FK → outlet.id, nullable)
  - restaurantId: uuid (FK → restaurant.id, nullable)
  - sortOrder: integer (default 0)

### `src/db/schema/index.ts`
- Export all schemas and relations

3. Run `pnpm db:push` to create tables in Supabase
4. Verify tables exist in Supabase dashboard

---

## Task 4: DB Schema — Supporting Entities
**Status:** [x] DONE

### `src/db/schema/subscription.ts`
- Table: subscription
  - id: uuid (PK)
  - accountId: uuid (FK → account.id, unique)
  - plan: text (default 'annual')
  - status: text (check: active|expired|cancelled)
  - startedAt: timestamp
  - expiresAt: timestamp
  - paymentMethod: text
  - externalPaymentId: text (nullable — from QRIS provider)
  - createdAt: timestamp

### `src/db/schema/redemption.ts`
- Table: redemption
  - id: uuid (PK)
  - accountId: uuid (FK → account.id)
  - outletId: uuid (FK → outlet.id)
  - qrToken: text (unique)
  - status: text (check: active|redeemed|expired)
  - redeemedAt: timestamp (nullable)
  - expiresAt: timestamp
  - createdAt: timestamp

### `src/db/schema/invite.ts`
- Table: invite
  - id: uuid (PK)
  - code: text (unique, 7-char alphanumeric)
  - createdBy: uuid (FK → account.id)
  - redeemedBy: uuid (FK → account.id, nullable)
  - maxUses: integer (default 10)
  - usedCount: integer (default 0)
  - isActive: boolean (default true)
  - expiresAt: timestamp (nullable)
  - createdAt: timestamp

### `src/db/schema/notification.ts`
- Table: notification
  - id: uuid (PK)
  - accountId: uuid (FK → account.id)
  - type: text (check: redemption|subscription|invite|system)
  - title: text
  - body: text
  - data: jsonb (nullable)
  - isRead: boolean (default false)
  - createdAt: timestamp

4. Run `pnpm db:push` again
5. Create `src/db/seed.ts` — seed script with:
  - 1 restaurant brand with 2 outlets
  - 3 merchant accounts (owner, manager, staff)
  - 5 member accounts with active subscriptions
  - 5 redemptions (mix of statuses)
  - 3 invite codes
   Run `pnpm db:seed`

---

## Task 5: Better Auth Setup
**Status:** [x] DONE

Use Context7 MCP to get latest Better Auth setup docs before implementing.

1. Install additional deps if needed: `pnpm add better-auth @better-auth/drizzle`
2. Create `src/lib/auth.ts`:
   - Configure Better Auth with:
     - Database: use Drizzle adapter pointing to Postgres
     - emailAndPassword: enabled (for merchant login)
     - Phone OTP: enabled (for member registration)
     - Session: JWT + database session, httpOnly cookies
     - RBAC: enabled with roles (owner, manager, staff, member, admin)
   - Export auth handler, auth middleware
3. Create `src/routes/auth.ts`:
   - POST /auth/register — phone number registration, trigger OTP
   - POST /auth/verify-otp — verify OTP, create member account
   - POST /auth/merchant/login — email + password login
   - POST /auth/merchant/forgot-password — send reset email (placeholder)
   - GET /auth/me — get current user + roles
   - POST /auth/logout
4. Mount auth routes in `src/index.ts`
5. Create `src/middleware/auth.ts`:
   - Helper to get current session from request
   - Role check middleware (requireRole('owner'))
6. Test: start dev server, verify /auth endpoints respond

---

## Task 6: API Middleware & Error Handling
**Status:** [x] DONE

1. Create `src/middleware/error-handler.ts`:
   - Global error handler (catch all)
   - Structured JSON error response: { error: { code, message, details? } }
   - Map common errors (validation, not found, unauthorized, etc.)
2. Create `src/middleware/rate-limiter.ts`:
   - Simple in-memory rate limiter (per IP)
   - Configurable: windowMs, maxRequests
   - Apply stricter limits to /auth endpoints
3. Create `src/lib/response.ts`:
   - Helper functions: success(), error(), paginated()
   - Consistent response envelope
4. Apply middleware in `src/index.ts`:
   - Error handler (global)
   - Rate limiter (on /auth routes)
   - Request logging
5. Test: send invalid request → get structured error, rapid requests → get rate limited

---

## Task 7: Restaurant Routes
**Status:** [x] DONE

1. Create `src/routes/restaurants.ts`:
   - GET /restaurants/discover
     - Query params: cuisine (string), sort (nearest|rating|newest), lat/lng (optional for distance), page/limit
     - Filter by: isOpen=true, status=active
     - Include: outlet photos (first as cover), avgRating, cuisineTags, halalCertified
     - Pagination: cursor-based or offset
     - Response: list of restaurants with pagination meta
   - GET /restaurants/:id
     - Full restaurant detail with all outlets
     - Include: photos, operating hours, BOGO limit, contact info
   - GET /restaurants/search
     - Query param: q (search term)
     - Search in: name, cuisine, address
     - Return: list of matching restaurants
2. Mount in `src/index.ts`
3. Test with seed data

---

## Task 8: Redemption Routes
**Status:** [x] DONE

1. Create `src/routes/redemptions.ts`:
   - POST /redemptions/create
     - Auth required (member)
     - Body: outletId
     - Validate: active subscription, not already redeemed at this outlet this year, outlet is open
     - Generate: unique QR token (nanoid or crypto.randomBytes)
     - Set: expiresAt = now() + 5 minutes
     - Response: { qrToken, expiresAt }
   - POST /redemptions/verify
     - Auth required (merchant)
     - Body: qrToken
     - Validate: token exists, not expired, not already redeemed
     - Update: status=redeemed, redeemedAt=now()
     - Response: { success: true, redemption details }
   - GET /redemptions/my
     - Auth required (member)
     - Query params: status (optional filter), page/limit
     - Response: paginated list of member's redemptions
   - GET /redemptions/today
     - Auth required (merchant)
     - Response: today's redemptions for current outlet
2. Mount in `src/index.ts`
3. Test full flow: create → verify → check history

---

## Task 9: Merchant Routes
**Status:** [x] DONE

1. Create `src/routes/merchant.ts`:
   - GET /merchant/dashboard
     - Auth required (merchant)
     - Based on outletId (from session/role)
     - Return: today's scan count, this week's count, total redemptions, recent redemptions list
   - GET /merchant/outlet/:id
     - Auth required, role check (must have access to this outlet)
     - Return: full outlet details
   - PUT /merchant/outlet/:id
     - Auth required, role check (owner or manager only)
     - Updatable: label, address, lat/lng, operatingHours, isOpen, bogoLimit, contacts, instagramHandle, status
   - GET /merchant/restaurant/:id
     - Auth required, role check (owner only)
     - Return: restaurant brand details
   - PUT /merchant/restaurant/:id
     - Auth required, role check (owner only)
     - Updatable: name, description, cuisineTags, halalCertified, logo
2. Mount in `src/index.ts`

---

## Task 10: Subscription & Invite Routes
**Status:** [x] DONE

1. Create `src/routes/subscription.ts`:
   - POST /subscription/create
     - Auth required (member)
     - Body: plan (default 'annual')
     - Validate: no active subscription
     - Create subscription record with status 'pending_payment'
     - Response: { subscriptionId, amount, paymentMethod }
     - Note: actual QRIS integration will be added later — return mock payment URL for now
   - GET /subscription/status
     - Auth required
     - Response: current subscription details + expiry info
2. Create `src/routes/invites.ts`:
   - POST /invites/generate
     - Auth required (member with active subscription)
     - Body: count (optional, default 1)
     - Generate unique 7-char codes
     - Response: generated invite codes
   - POST /invites/redeem
     - Body: code
     - Validate: code exists, active, not expired, under maxUses
     - Mark code as used, increment usedCount
     - Response: success + code details
3. Mount in `src/index.ts`

---

## Task 11: Git Commit & Push
**Status:** [ ] TODO

After ALL tasks above are complete:
1. Run `pnpm typecheck` — fix any type errors
2. Run `pnpm lint` — fix any lint errors
3. `git add -A`
4. `git commit -m "feat: complete API backend — auth, schema, all MVP endpoints"`
5. `git push`

---

## DONE?
After all tasks complete, write a summary to `.project-memory/sessions/2026-03-31-forge-api-backend.md` including:
- What was built
- DB tables created
- API endpoints implemented
- Any issues or decisions made
- What's next
