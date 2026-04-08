CREATE TABLE "invite_redemption" (
	"id" text PRIMARY KEY NOT NULL,
	"invite_id" text NOT NULL,
	"account_id" text NOT NULL,
	"phase" text NOT NULL,
	"claimed_at" timestamp NOT NULL,
	"consumed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invite_redemption" ADD CONSTRAINT "invite_redemption_invite_id_invite_id_fk" FOREIGN KEY ("invite_id") REFERENCES "public"."invite"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite_redemption" ADD CONSTRAINT "invite_redemption_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite" ADD COLUMN "type" text DEFAULT 'single_use' NOT NULL;--> statement-breakpoint
ALTER TABLE "invite" ADD COLUMN "max_redemptions" integer;--> statement-breakpoint
ALTER TABLE "invite" ADD COLUMN "redeemed_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "invite" DROP CONSTRAINT "invite_redeemer_id_account_id_fk";--> statement-breakpoint
ALTER TABLE "invite" DROP COLUMN "redeemer_id";--> statement-breakpoint
ALTER TABLE "invite" DROP COLUMN "redeemed_at";--> statement-breakpoint
CREATE UNIQUE INDEX "unique_invite_account" ON "invite_redemption" USING btree ("invite_id","account_id");
