import {
  pgTable,
  text,
  boolean,
  integer,
  jsonb,
  timestamp,
  doublePrecision,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// ========================================
// Better Auth Core Tables
// ========================================

export const user = pgTable("account", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").unique(),
  emailVerified: boolean("email_verified").default(false),
  image: text("image"),
  // Phone-number plugin fields
  phoneNumber: text("phone_number"),
  phoneNumberVerified: boolean("phone_number_verified").default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Better Auth's internal "account" model — stores OAuth credentials & password hashes
export const authCredential = pgTable("auth_credential", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  idToken: text("id_token"),
  password: text("password"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ========================================
// Business Tables
// ========================================

export const restaurant = pgTable("restaurant", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  description: text("description"),
  cuisineTags: text("cuisine_tags").array(),
  halalCertified: boolean("halal_certified").default(false),
  logo: text("logo"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const outlet = pgTable("outlet", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  restaurantId: text("restaurant_id")
    .notNull()
    .references(() => restaurant.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  address: text("address").notNull(),
  lat: doublePrecision("lat"),
  lng: doublePrecision("lng"),
  operatingHours: jsonb("operating_hours"),
  isOpen: boolean("is_open").default(true),
  bogoLimit: integer("bogo_limit").default(1),
  avgTableSpend: integer("avg_table_spend"),
  whatsappNumber: text("whatsapp_number"),
  phoneContact: text("phone_contact"),
  instagramHandle: text("instagram_handle"),
  status: text("status").default("pending").notNull(), // active | pending | suspended
  joinedDate: timestamp("joined_date").defaultNow(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const accountRole = pgTable(
  "account_role",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    accountId: text("account_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    outletId: text("outlet_id")
      .notNull()
      .references(() => outlet.id, { onDelete: "cascade" }),
    role: text("role").notNull(), // owner | manager | staff
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    uniqueAccountOutlet: uniqueIndex("unique_account_outlet").on(
      t.accountId,
      t.outletId
    ),
    accountRoleOutletIdx: index("account_role_outlet_idx").on(t.outletId),
  })
);

export const restaurantPhoto = pgTable("restaurant_photo", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  outletId: text("outlet_id")
    .notNull()
    .references(() => outlet.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  label: text("label"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const subscription = pgTable("subscription", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  accountId: text("account_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  status: text("status").default("active").notNull(), // active | expired | cancelled
  plan: text("plan").notNull(), // monthly | yearly
  startDate: timestamp("start_date").defaultNow(),
  endDate: timestamp("end_date"),
  paymentMethod: text("payment_method"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  subscriptionAccountStatusIdx: index("subscription_account_status_idx").on(t.accountId, t.status),
}));

export const redemption = pgTable("redemption", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  accountId: text("account_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  outletId: text("outlet_id")
    .notNull()
    .references(() => outlet.id, { onDelete: "cascade" }),
  qrToken: text("qr_token").notNull().unique(),
  status: text("status").default("pending").notNull(), // pending | confirmed | cancelled
  redeemedAt: timestamp("redeemed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  redemptionAccountOutletIdx: index("redemption_account_outlet_idx").on(t.accountId, t.outletId),
  redemptionOutletCreatedIdx: index("redemption_outlet_created_idx").on(t.outletId, t.createdAt),
}));

export const invite = pgTable("invite", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  code: text("code").notNull().unique(),
  referrerId: text("referrer_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  redeemerId: text("redeemer_id").references(() => user.id, {
    onDelete: "set null",
  }),
  status: text("status").default("active").notNull(), // active | used | expired
  expiresAt: timestamp("expires_at"),
  redeemedAt: timestamp("redeemed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// NOTE: Notification table is reserved for future push notification features.
// Not currently used by any route handlers.
export const notification = pgTable("notification", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  accountId: text("account_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  body: text("body").notNull(),
  type: text("type").notNull(),
  read: boolean("read").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ========================================
// Relations
// ========================================

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  authCredentials: many(authCredential),
  roles: many(accountRole),
  subscriptions: many(subscription),
  redemptions: many(redemption),
  sentInvites: many(invite, { relationName: "referrer" }),
  notifications: many(notification),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, {
    fields: [session.userId],
    references: [user.id],
  }),
}));

export const authCredentialRelations = relations(authCredential, ({ one }) => ({
  user: one(user, {
    fields: [authCredential.userId],
    references: [user.id],
  }),
}));

export const restaurantRelations = relations(restaurant, ({ many }) => ({
  outlets: many(outlet),
}));

export const outletRelations = relations(outlet, ({ one, many }) => ({
  restaurant: one(restaurant, {
    fields: [outlet.restaurantId],
    references: [restaurant.id],
  }),
  photos: many(restaurantPhoto),
  roles: many(accountRole),
  redemptions: many(redemption),
}));

export const accountRoleRelations = relations(accountRole, ({ one }) => ({
  account: one(user, {
    fields: [accountRole.accountId],
    references: [user.id],
  }),
  outlet: one(outlet, {
    fields: [accountRole.outletId],
    references: [outlet.id],
  }),
}));

export const restaurantPhotoRelations = relations(restaurantPhoto, ({ one }) => ({
  outlet: one(outlet, {
    fields: [restaurantPhoto.outletId],
    references: [outlet.id],
  }),
}));

export const subscriptionRelations = relations(subscription, ({ one }) => ({
  account: one(user, {
    fields: [subscription.accountId],
    references: [user.id],
  }),
}));

export const redemptionRelations = relations(redemption, ({ one }) => ({
  account: one(user, {
    fields: [redemption.accountId],
    references: [user.id],
  }),
  outlet: one(outlet, {
    fields: [redemption.outletId],
    references: [outlet.id],
  }),
}));

export const inviteRelations = relations(invite, ({ one }) => ({
  referrer: one(user, {
    fields: [invite.referrerId],
    references: [user.id],
    relationName: "referrer",
  }),
  redeemer: one(user, {
    fields: [invite.redeemerId],
    references: [user.id],
    relationName: "redeemer",
  }),
}));

export const notificationRelations = relations(notification, ({ one }) => ({
  account: one(user, {
    fields: [notification.accountId],
    references: [user.id],
  }),
}));
