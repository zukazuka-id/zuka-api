--> statement-breakpoint
ALTER TABLE "restaurant_photo"
  ADD COLUMN "restaurant_id" text REFERENCES "restaurant"("id") ON DELETE cascade,
  ADD COLUMN "imagekit_file_id" text,
  ADD COLUMN "imagekit_url" text,
  ADD COLUMN "sort_order" integer NOT NULL DEFAULT 0,
  ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "restaurant_photo"
  ALTER COLUMN "outlet_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "restaurant_photo"
  ADD CONSTRAINT "restaurant_photo_parent_check"
  CHECK ((("restaurant_id" IS NOT NULL) <> ("outlet_id" IS NOT NULL)));
--> statement-breakpoint
CREATE INDEX "restaurant_photo_restaurant_idx" ON "restaurant_photo" USING btree ("restaurant_id");
--> statement-breakpoint
CREATE INDEX "restaurant_photo_outlet_sort_idx" ON "restaurant_photo" USING btree ("outlet_id", "sort_order");
