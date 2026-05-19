CREATE TABLE "payment_transaction" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"subscription_id" text,
	"order_id" text NOT NULL,
	"provider" text NOT NULL,
	"provider_reference" text,
	"method" text NOT NULL,
	"amount" integer NOT NULL,
	"currency" text DEFAULT 'IDR' NOT NULL,
	"plan" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"qris_payload" text,
	"timeout_in_seconds" integer,
	"expires_at" timestamp,
	"paid_at" timestamp,
	"rrn" text,
	"raw_create_response" jsonb,
	"raw_webhook_payload" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "payment_transaction_status_check" CHECK ("payment_transaction"."status" in ('pending', 'paid', 'expired', 'failed', 'cancelled')),
	CONSTRAINT "payment_transaction_method_check" CHECK ("payment_transaction"."method" in ('qris')),
	CONSTRAINT "payment_transaction_provider_check" CHECK ("payment_transaction"."provider" in ('yukk'))
);
--> statement-breakpoint
ALTER TABLE "payment_transaction" ADD CONSTRAINT "payment_transaction_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_transaction" ADD CONSTRAINT "payment_transaction_subscription_id_subscription_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscription"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payment_transaction_account_status_idx" ON "payment_transaction" USING btree ("account_id","status");--> statement-breakpoint
CREATE INDEX "payment_transaction_order_idx" ON "payment_transaction" USING btree ("order_id");