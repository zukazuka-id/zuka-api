ALTER TABLE "session" ADD COLUMN "impersonated_by" text;--> statement-breakpoint
ALTER TABLE "account" ADD COLUMN "role" text DEFAULT 'user';--> statement-breakpoint
ALTER TABLE "account" ADD COLUMN "banned" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "account" ADD COLUMN "ban_reason" text;--> statement-breakpoint
ALTER TABLE "account" ADD COLUMN "ban_expires" timestamp;