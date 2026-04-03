CREATE INDEX "account_role_outlet_idx" ON "account_role" USING btree ("outlet_id");--> statement-breakpoint
CREATE INDEX "redemption_account_outlet_idx" ON "redemption" USING btree ("account_id","outlet_id");--> statement-breakpoint
CREATE INDEX "redemption_outlet_created_idx" ON "redemption" USING btree ("outlet_id","created_at");--> statement-breakpoint
CREATE INDEX "subscription_account_status_idx" ON "subscription" USING btree ("account_id","status");