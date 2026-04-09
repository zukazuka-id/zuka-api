--> statement-breakpoint
CREATE TABLE "platform_config" (
  "key" text PRIMARY KEY NOT NULL,
  "value" text NOT NULL,
  "is_public" boolean NOT NULL DEFAULT false,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "updated_by" text REFERENCES "account"("id") ON DELETE set null
);
--> statement-breakpoint
INSERT INTO "platform_config" ("key", "value", "is_public") VALUES ('daily_invite_limit', '10', true);
--> statement-breakpoint
CREATE INDEX "idx_invite_referrer" ON "invite" USING btree ("referrer_id");
--> statement-breakpoint
CREATE INDEX "idx_ir_invite_phase" ON "invite_redemption" USING btree ("invite_id", "phase");
