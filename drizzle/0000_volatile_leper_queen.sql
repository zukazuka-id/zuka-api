CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"email_verified" boolean DEFAULT false,
	"image" text,
	"phone_number" text,
	"phone_number_verified" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "account_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "account_role" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"outlet_id" text NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_credential" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"id_token" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invite" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"referrer_id" text NOT NULL,
	"redeemer_id" text,
	"status" text DEFAULT 'active' NOT NULL,
	"expires_at" timestamp,
	"redeemed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "invite_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "notification" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"type" text NOT NULL,
	"read" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outlet" (
	"id" text PRIMARY KEY NOT NULL,
	"restaurant_id" text NOT NULL,
	"label" text NOT NULL,
	"address" text NOT NULL,
	"lat" double precision,
	"lng" double precision,
	"operating_hours" jsonb,
	"is_open" boolean DEFAULT true,
	"bogo_limit" integer DEFAULT 1,
	"avg_table_spend" integer,
	"whatsapp_number" text,
	"phone_contact" text,
	"instagram_handle" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"joined_date" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "redemption" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"outlet_id" text NOT NULL,
	"qr_token" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"redeemed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "redemption_qr_token_unique" UNIQUE("qr_token")
);
--> statement-breakpoint
CREATE TABLE "restaurant" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"cuisine_tags" text[],
	"halal_certified" boolean DEFAULT false,
	"logo" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "restaurant_photo" (
	"id" text PRIMARY KEY NOT NULL,
	"outlet_id" text NOT NULL,
	"url" text NOT NULL,
	"label" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "subscription" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"plan" text NOT NULL,
	"start_date" timestamp DEFAULT now(),
	"end_date" timestamp,
	"payment_method" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account_role" ADD CONSTRAINT "account_role_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_role" ADD CONSTRAINT "account_role_outlet_id_outlet_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlet"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_credential" ADD CONSTRAINT "auth_credential_user_id_account_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite" ADD CONSTRAINT "invite_referrer_id_account_id_fk" FOREIGN KEY ("referrer_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite" ADD CONSTRAINT "invite_redeemer_id_account_id_fk" FOREIGN KEY ("redeemer_id") REFERENCES "public"."account"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outlet" ADD CONSTRAINT "outlet_restaurant_id_restaurant_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "redemption" ADD CONSTRAINT "redemption_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "redemption" ADD CONSTRAINT "redemption_outlet_id_outlet_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlet"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restaurant_photo" ADD CONSTRAINT "restaurant_photo_outlet_id_outlet_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlet"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_account_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "unique_account_outlet" ON "account_role" USING btree ("account_id","outlet_id");