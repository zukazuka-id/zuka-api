# Invite Code System Redesign

**Date:** 2026-04-07
**Status:** Approved
**Scope:** zuka-api (backend), member-forge (frontend instructions)

---

## Problem

The current invite system has two issues:

1. **Premature redemption** — `POST /invites/redeem` immediately marks a code as `used` when submitted, before the user has registered or paid. A code can be "consumed" by someone who never completes signup.
2. **Single-use only** — every code is single-use. This doesn't work for influencer campaigns where one code needs to serve hundreds or thousands of signups.

---

## Design Decisions

| Decision | Choice | Reason |
|---|---|---|
| Redemption trigger | Two-phase: claimed on registration, consumed on payment | Prevents codes being wasted on users who don't convert |
| Multi-use support | Flexible — admin picks per code: capped or unlimited | Supports both influencer (capped) and viral (unlimited) campaigns |
| Code benefit | Tracking only — no financial reward for redeemer | Codes are for acquisition tracking, not discounts |
| Referrer reward | None | Pure tracking, no incentive system needed |
| Who creates codes | Members (single-use only), Admin (any type) | Members share with friends; admins run campaigns |
| Code input in app | Manual field + deep link | Manual for friend-shared codes, deep links for influencer campaigns |

---

## Database Schema

### `invite` table (modified)

| Column | Type | Notes |
|---|---|---|
| `id` | `text` PK | UUID, auto-generated |
| `code` | `text` unique | 8-char alphanumeric, no ambiguous chars (I/O/0/1) |
| `referrerId` | `text` FK → user | Who created the code |
| `type` | `text` | `single_use` (default) or `multi_use` |
| `max_redemptions` | `integer` nullable | `null` = unlimited. Only relevant for `multi_use` |
| `redeemed_count` | `integer` | Default 0. Incremented per claim |
| `status` | `text` | `active` or `inactive`. Admin can deactivate a code |
| `expiresAt` | `timestamp` | Expiry date |
| `createdAt` | `timestamp` | Default now |

**Removed columns:** `redeemerId`, `redeemedAt` — moved to junction table.

**Derived states (computed, not stored):**

| State | Logic |
|---|---|
| Claimed | Has rows in `invite_redemption` with `phase = claimed` |
| Consumed | Has rows in `invite_redemption` with `phase = consumed` |
| Expired | `expiresAt < now()` AND `status = active` |
| Inactive | `status = inactive` (admin deactivated) |

### `invite_redemption` table (new)

| Column | Type | Notes |
|---|---|---|
| `id` | `text` PK | UUID, auto-generated |
| `inviteId` | `text` FK → invite | Which code was used |
| `accountId` | `text` FK → user | Who redeemed |
| `phase` | `text` | `claimed` or `consumed` |
| `claimedAt` | `timestamp` | When user registered with this code |
| `consumedAt` | `timestamp` | When user paid with this code |
| `createdAt` | `timestamp` | Default now |

**Unique constraint:** `(inviteId, accountId)` — one user can only redeem a code once.

---

## API Endpoints

### Validate code (public)

```
POST /api/v1/invites/redeem
Body: { code: "A3KN7R2P" }
```

Validates the code exists, is `active`, not past `expiresAt`. For single-use: checks no existing `invite_redemption` row. For multi-use: checks `redeemed_count < max_redemptions` (skip if null).

**Does NOT write to DB.** Returns invite details for the frontend to display.

**Response:**
```json
{
  "valid": true,
  "code": "A3KN7R2P",
  "type": "single_use"
}
```

### Claim phase (during registration)

No new endpoint. Modified `POST /api/v1/auth/verify-otp` to accept optional `inviteCode`:

```
POST /api/v1/auth/verify-otp
Body: { phoneNumber: "+6281234567890", code: "123456", inviteCode: "A3KN7R2P" }
```

On successful OTP verification:
1. Look up the invite by code
2. Validate it's still active and not expired
3. Insert into `invite_redemption` with `phase = claimed`, `claimedAt = now()`
4. Increment `invite.redeemed_count`

### Consume phase (during payment)

No new endpoint. Modified `POST /api/v1/subscription/create` — auto-detects claimed invite:

On successful subscription creation:
1. Look up `invite_redemption` where `accountId = user.id` AND `phase = claimed`
2. If found, update to `phase = consumed`, `consumedAt = now()`

No changes to the request body needed — user is already authenticated.

### Generate codes (member, auth required)

```
POST /api/v1/invites/generate
Auth: required + active subscription
Body: { count: 3 }  (max 10)
```

Unchanged — always creates `single_use` codes.

### Admin endpoints

```
POST /admin/invites/create
Body: { referrerId, count, expiresDays, type: "single_use"|"multi_use", maxRedemptions?: number }
```

Updated to accept `type` and `maxRedemptions` fields.

```
POST /admin/invites/:id/deactivate
```

Sets `status = inactive`. Replaces old `revoke` endpoint.

```
POST /admin/invites/:id/reactivate
```

Sets `status = active`. New endpoint.

```
GET /admin/invites
```

Updated to include redemption stats from `invite_redemption` junction.

---

## Member App UX Flow (for member-forge)

### Registration screens

**Step 1 — Enter Invite Code (optional)**

```
┌─────────────────────────────┐
│  Enter Invite Code          │
│  (optional, skip button)    │
│  [ A3KN7R2P          ]     │
│                             │
│  [ Continue ]  [ Skip ]     │
└──────────────────────────────┘
```

- On "Continue": call `POST /invites/redeem { code }` to validate
- If valid: store `inviteCode` in app state, proceed to step 2
- If invalid: show error, allow retry or skip
- On "Skip": proceed to step 2 with no invite code

**Step 2 — Enter Phone Number**

```
┌─────────────────────────────┐
│  Enter Phone Number         │
│  [ +62 812 3456 7890 ]     │
│                             │
│  [ Send OTP ]               │
└──────────────────────────────┘
```

- Call `POST /auth/register { phoneNumber }`
- `inviteCode` stays in app state (not sent to this endpoint)

**Step 3 — Enter OTP**

```
┌─────────────────────────────┐
│  Enter OTP                  │
│  [ 1 2 3 4 5 6 ]           │
│                             │
│  [ Verify ]                 │
└──────────────────────────────┘
```

- Call `POST /auth/verify-otp { phoneNumber, code, inviteCode }`
- If `inviteCode` is present: backend creates user + claims invite
- If no `inviteCode`: backend creates user normally

**Step 4 — Home Screen**

No special handling. If user subscribes later, backend auto-detects and consumes any claimed invite.

### Deep link handling

- URL format: `https://zuka.id/invite/A3KN7R2P`
- App opens on Step 1 with code pre-filled
- User taps "Continue" to validate, then proceeds through phone + OTP
- Same state management: `inviteCode` held in local state across screens

### Frontend state management

- Store `inviteCode` in local state (e.g. React state, Zustand, or equivalent)
- Persist across screen navigation: register → verify-otp
- Clear after `verify-otp` response (one-time use in flow)
- If app is killed mid-flow, code is lost — user re-enters on next launch

---

## Migration Notes

### Data migration from old schema

Existing `invite` rows with `redeemerId` and `redeemedAt` need to be migrated:
- For each row where `redeemerId IS NOT NULL`: insert into `invite_redemption` with `phase = consumed`, `accountId = redeemerId`, `claimedAt = redeemedAt`, `consumedAt = redeemedAt`
- Drop `redeemerId` and `redeemedAt` columns from `invite`
- Add `type`, `max_redemptions`, `redeemed_count` columns

### Schema changes summary

1. Add `type` column to `invite` (text, default `single_use`)
2. Add `max_redemptions` column to `invite` (integer, nullable)
3. Add `redeemed_count` column to `invite` (integer, default 0)
4. Migrate `redeemerId`/`redeemedAt` data to `invite_redemption`
5. Drop `redeemerId` and `redeemedAt` from `invite`
6. Create `invite_redemption` table with unique constraint on `(inviteId, accountId)`

---

## Out of Scope

- Referrer rewards or incentive system
- Discount or free trial on invite code redemption
- QR code generation for invite codes
- Email/SMS sharing of invite codes from the app
- Admin analytics dashboard for campaign performance
