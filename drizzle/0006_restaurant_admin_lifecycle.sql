--> statement-breakpoint
ALTER TABLE "restaurant"
  ADD COLUMN "status" text DEFAULT 'pending' NOT NULL,
  ADD COLUMN "operating_hours" jsonb,
  ADD COLUMN "default_bogo_limit" integer DEFAULT 1 NOT NULL,
  ADD COLUMN "default_avg_table_spend" integer,
  ADD COLUMN "whatsapp_number" text,
  ADD COLUMN "phone_number" text,
  ADD COLUMN "instagram_handle" text,
  ADD COLUMN "tiktok_handle" text,
  ADD COLUMN "facebook_url" text,
  ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "restaurant"
  ADD CONSTRAINT "restaurant_status_check"
  CHECK ("status" IN ('pending', 'active', 'suspended', 'archived'));
--> statement-breakpoint
ALTER TABLE "outlet"
  ADD COLUMN "is_manually_closed" boolean DEFAULT false NOT NULL,
  ADD COLUMN "manual_close_reopen_strategy" text DEFAULT 'indefinite' NOT NULL,
  ADD COLUMN "manual_close_reopen_at" timestamp,
  ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "outlet"
  ADD CONSTRAINT "outlet_status_check"
  CHECK ("status" IN ('pending', 'active', 'suspended', 'archived'));
--> statement-breakpoint
ALTER TABLE "outlet"
  ADD CONSTRAINT "outlet_manual_close_reopen_strategy_check"
  CHECK ("manual_close_reopen_strategy" IN ('next_hours', 'custom', 'indefinite'));
