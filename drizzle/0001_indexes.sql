CREATE INDEX IF NOT EXISTS "entries_type_status" ON "content_entries" USING btree ("type_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reviews_status" ON "review_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reviews_entry_status" ON "review_requests" USING btree ("entry_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deliveries_webhook_created" ON "webhook_deliveries" USING btree ("webhook_id","created_at");