import "dotenv/config";
import { db } from "./index.js";
import {
  user,
  restaurant,
  outlet,
  accountRole,
  restaurantPhoto,
  subscription,
  redemption,
  invite,
  notification,
} from "./schema.js";
import { eq } from "drizzle-orm";

async function seed() {
  console.log("Seeding database...");

  // Clean existing data (reverse dependency order)
  const tables = [
    notification,
    invite,
    redemption,
    subscription,
    restaurantPhoto,
    accountRole,
    outlet,
    restaurant,
    user,
  ];
  for (const table of tables) {
    await db.delete(table);
  }
  console.log("Cleared existing data.");

  // --- Accounts (users) ---
  const [owner] = await db
    .insert(user)
    .values([
      { id: "seed-owner-1", name: "Rina Sari", email: "rina@bogogo.id", emailVerified: true, phoneNumber: "+6281234567890", phoneNumberVerified: true },
      { id: "seed-manager-1", name: "Budi Santoso", email: "budi@bogogo.id", emailVerified: true, phoneNumber: "+6281234567891", phoneNumberVerified: true },
      { id: "seed-staff-1", name: "Dewi Ayu", email: "dewi@bogogo.id", emailVerified: true },
      { id: "seed-member-1", name: "Andi Wijaya", email: "andi@gmail.com", emailVerified: true, phoneNumber: "+6281234567892", phoneNumberVerified: true },
    ])
    .returning();

  // --- Restaurants ---
  const [warungPadang] = await db
    .insert(restaurant)
    .values([
      { id: "seed-resto-1", name: "Warung Padang Sederhana", description: "Authentic Padang cuisine with rich rendang and gulai.", cuisineTags: ["Padang", "Indonesian"], halalCertified: true, logo: "https://example.com/logos/padang.png" },
      { id: "seed-resto-2", name: "Sushi Tei", description: "Japanese dining experience with fresh sushi and sashimi.", cuisineTags: ["Japanese", "Sushi"], halalCertified: false, logo: "https://example.com/logos/sushitei.png" },
    ])
    .returning();

  // --- Outlets ---
  const [outletKemang] = await db
    .insert(outlet)
    .values([
      {
        id: "seed-outlet-1",
        restaurantId: "seed-resto-1",
        label: "Kemang",
        address: "Jl. Kemang Raya No. 45, Jakarta Selatan",
        lat: -6.2615,
        lng: 106.8106,
        operatingHours: { mon: "10:00-22:00", tue: "10:00-22:00", wed: "10:00-22:00", thu: "10:00-22:00", fri: "10:00-23:00", sat: "10:00-23:00", sun: "11:00-21:00" },
        isOpen: true,
        bogoLimit: 2,
        avgTableSpend: 85000,
        whatsappNumber: "+6281234567001",
        phoneContact: "+6281234567002",
        instagramHandle: "@warungpadang_kemang",
        status: "active",
      },
      {
        id: "seed-outlet-2",
        restaurantId: "seed-resto-1",
        label: "BSD",
        address: "Jl. Serpong Garden, BSD City, Tangerang",
        lat: -6.3002,
        lng: 106.6567,
        operatingHours: { mon: "10:00-21:00", tue: "10:00-21:00", wed: "10:00-21:00", thu: "10:00-21:00", fri: "10:00-22:00", sat: "10:00-22:00", sun: "11:00-21:00" },
        isOpen: true,
        bogoLimit: 1,
        avgTableSpend: 75000,
        whatsappNumber: "+6281234567003",
        status: "active",
      },
      {
        id: "seed-outlet-3",
        restaurantId: "seed-resto-2",
        label: "Pondok Indah Mall",
        address: "Pondok Indah Mall Lt. 3, Jl. Metro Pondok Indah, Jakarta Selatan",
        lat: -6.2764,
        lng: 106.7834,
        operatingHours: { mon: "10:00-22:00", tue: "10:00-22:00", wed: "10:00-22:00", thu: "10:00-22:00", fri: "10:00-22:00", sat: "10:00-22:00", sun: "10:00-22:00" },
        isOpen: true,
        bogoLimit: 1,
        avgTableSpend: 150000,
        phoneContact: "+6281234567004",
        instagramHandle: "@sushitei_pim",
        status: "active",
      },
    ])
    .returning();

  // --- Account Roles ---
  await db.insert(accountRole).values([
    { id: "seed-role-1", accountId: "seed-owner-1", outletId: "seed-outlet-1", role: "owner" },
    { id: "seed-role-2", accountId: "seed-owner-1", outletId: "seed-outlet-2", role: "owner" },
    { id: "seed-role-3", accountId: "seed-manager-1", outletId: "seed-outlet-1", role: "manager" },
    { id: "seed-role-4", accountId: "seed-staff-1", outletId: "seed-outlet-1", role: "staff" },
    { id: "seed-role-5", accountId: "seed-owner-1", outletId: "seed-outlet-3", role: "owner" },
  ]);

  // --- Restaurant Photos ---
  await db.insert(restaurantPhoto).values([
    { id: "seed-photo-1", outletId: "seed-outlet-1", url: "https://example.com/photos/padang-kemang-1.jpg", label: "Interior" },
    { id: "seed-photo-2", outletId: "seed-outlet-1", url: "https://example.com/photos/padang-kemang-2.jpg", label: "Rendang" },
    { id: "seed-photo-3", outletId: "seed-outlet-3", url: "https://example.com/photos/sushitei-pim-1.jpg", label: "Sushi Bar" },
  ]);

  // --- Subscription ---
  await db.insert(subscription).values([
    {
      id: "seed-sub-1",
      accountId: "seed-member-1",
      status: "active",
      plan: "monthly",
      startDate: new Date("2026-03-01"),
      endDate: new Date("2026-04-01"),
      paymentMethod: "qris",
    },
  ]);

  // --- Redemptions ---
  await db.insert(redemption).values([
    {
      id: "seed-redemption-1",
      accountId: "seed-member-1",
      outletId: "seed-outlet-1",
      qrToken: "qr-abc123",
      status: "confirmed",
      redeemedAt: new Date("2026-03-15T12:30:00Z"),
    },
    {
      id: "seed-redemption-2",
      accountId: "seed-member-1",
      outletId: "seed-outlet-3",
      qrToken: "qr-def456",
      status: "pending",
    },
  ]);

  // --- Invite ---
  await db.insert(invite).values([
    { id: "seed-invite-1", code: "A3KN7R2P", referrerId: "seed-member-1", status: "active", expiresAt: new Date("2026-04-30") },
    { id: "seed-invite-2", code: "H9T4MXW5", referrerId: "seed-member-1", status: "active", expiresAt: new Date("2026-04-30") },
    { id: "seed-invite-3", code: "P2Q8CNV6", referrerId: "seed-member-1", status: "active", expiresAt: new Date("2026-05-15") },
    { id: "seed-invite-4", code: "J5RKWS3A", referrerId: "seed-member-1", status: "active", expiresAt: new Date("2026-05-15") },
    { id: "seed-invite-5", code: "N7B2YH4T", referrerId: "seed-member-1", status: "used", redeemerId: "seed-owner-1", redeemedAt: new Date("2026-03-20T10:00:00Z"), expiresAt: new Date("2026-04-30") },
    { id: "seed-invite-6", code: "L4F8PGX9", referrerId: "seed-member-1", status: "used", redeemerId: "seed-manager-1", redeemedAt: new Date("2026-03-22T14:30:00Z"), expiresAt: new Date("2026-04-30") },
    { id: "seed-invite-7", code: "C6M3ZJR7", referrerId: "seed-member-1", status: "expired", expiresAt: new Date("2026-02-01") },
    { id: "seed-invite-8", code: "W2K9NQH4", referrerId: "seed-member-1", status: "expired", expiresAt: new Date("2026-02-01") },
    { id: "seed-invite-9", code: "T8V5BLX3", referrerId: "seed-member-1", status: "active", expiresAt: new Date("2026-06-01") },
    { id: "seed-invite-10", code: "R3Y7DMF6", referrerId: "seed-member-1", status: "active", expiresAt: new Date("2026-06-01") },
  ]);

  // --- Notifications ---
  await db.insert(notification).values([
    {
      id: "seed-notif-1",
      accountId: "seed-member-1",
      title: "Welcome to BOGO GO!",
      body: "Your monthly subscription is active. Enjoy your BOGO deals!",
      type: "system",
      read: true,
    },
    {
      id: "seed-notif-2",
      accountId: "seed-member-1",
      title: "Redemption Confirmed",
      body: "Your BOGO redemption at Warung Padang Kemang was confirmed.",
      type: "redemption",
      read: false,
    },
  ]);

  console.log("Seed completed successfully!");
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
