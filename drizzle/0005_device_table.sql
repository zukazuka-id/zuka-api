-- drizzle/0005_device_table.sql
CREATE TABLE "device" (
  "id" TEXT PRIMARY KEY,
  "account_id" TEXT NOT NULL REFERENCES "account"("id") ON DELETE CASCADE,
  "token" TEXT NOT NULL UNIQUE,
  "platform" TEXT NOT NULL,
  "created_at" TIMESTAMP DEFAULT NOW() NOT NULL,
  "updated_at" TIMESTAMP DEFAULT NOW() NOT NULL
);

CREATE INDEX "device_account_idx" ON "device"("account_id");
